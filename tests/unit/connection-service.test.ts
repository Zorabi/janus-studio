import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { SaveConnectionInput } from "@janusgraph/domain";
import { ConnectionService } from "../../apps/desktop/src/main/services/connection-service.ts";
import type { GremlinService } from "../../apps/desktop/src/main/services/gremlin-service.ts";
import type { CredentialVault } from "../../apps/desktop/src/main/security/credential-vault.ts";
import { ConnectionRepository } from "../../apps/desktop/src/main/storage/connection-repository.ts";
import { openApplicationDatabase } from "../../apps/desktop/src/main/storage/database.ts";

const input: SaveConnectionInput = {
  name: "Proxied",
  protocol: "wss",
  host: "graph.example.test",
  port: 8182,
  path: "/gremlin",
  username: "",
  environment: "dev",
  connectionReadOnly: false,
  clientMode: "sessionless",
  traversalSource: "g",
  graphBinding: "graph",
  connectTimeoutMs: 5_000,
  queryTimeoutMs: 30_000,
  tlsRejectUnauthorized: true,
  tlsCaPath: "",
  tlsClientCertPath: "",
  tlsClientKeyPath: "",
  proxyMode: "manual",
  proxyUrl: "http://proxy.example.test:3128",
  proxyHost: "",
  proxyPort: 3128,
  proxyBypass: "localhost",
  proxyUsername: "proxy-user",
  proxyPassword: "proxy-secret",
  enableCompression: false,
  customHeaders: "{}",
};

test("encrypts and caches proxy passwords separately from ordinary connection fields", async () => {
  const directory = mkdtempSync(join(tmpdir(), "janus-studio-proxy-password-"));
  const database = openApplicationDatabase(join(directory, "app.sqlite"));
  const repository = new ConnectionRepository(database);
  const encryptedValues: string[] = [];
  const vault = {
    encrypt: async (value: string) => {
      encryptedValues.push(value);
      return Buffer.from(`encrypted:${value}`);
    },
    decrypt: async (value: Uint8Array) => Buffer.from(value).toString().replace(/^encrypted:/, ""),
  } as unknown as CredentialVault;
  const gremlin = { closeConnection: async () => undefined } as unknown as GremlinService;
  const service = new ConnectionService(repository, vault, gremlin);
  try {
    const saved = await service.save(input);
    assert.equal(saved.hasProxyPassword, true);
    assert.deepEqual(encryptedValues, ["proxy-secret"]);
    assert.equal(await service.proxyPasswordFor(saved.id), "proxy-secret");
    const row = database.prepare("SELECT proxy_password_cipher FROM connection_profiles WHERE id = ?").get(saved.id) as { proxy_password_cipher: Uint8Array };
    assert.equal(Buffer.from(row.proxy_password_cipher).toString(), "encrypted:proxy-secret");
    assert.equal(JSON.stringify(repository.find(saved.id)?.profile).includes("proxy-secret"), false);

    await service.save({ ...input, id: saved.id, proxyPassword: undefined });
    assert.equal((repository.find(saved.id)?.proxyPasswordCipher?.byteLength ?? 0) > 0, true);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
