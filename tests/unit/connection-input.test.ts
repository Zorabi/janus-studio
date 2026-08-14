import assert from "node:assert/strict";
import test from "node:test";
import { connectionInputSchema } from "../../apps/desktop/src/main/ipc/schemas.ts";

const base = {
  name: "Secure",
  protocol: "wss" as const,
  host: "graph.example.test",
  port: 8182,
  path: "/gremlin",
  username: "janus",
  environment: "prod" as const,
  connectionReadOnly: true,
  clientMode: "sessionless" as const,
  traversalSource: "g",
  graphBinding: "graph",
  connectTimeoutMs: 5_000,
  queryTimeoutMs: 30_000,
  tlsRejectUnauthorized: true,
  enableCompression: false,
  customHeaders: "{}",
};

test("accepts custom CA and complete mTLS credentials", () => {
  const parsed = connectionInputSchema.parse({
    ...base,
    tlsCaPath: "/certs/ca.pem",
    tlsClientCertPath: "/certs/client.pem",
    tlsClientKeyPath: "/certs/client.key",
    tlsClientKeyPassphrase: "encrypted-key-passphrase",
  });
  assert.equal(parsed.tlsClientKeyPath, "/certs/client.key");
});

test("rejects incomplete mTLS pairs and orphaned key passphrases", () => {
  assert.equal(connectionInputSchema.safeParse({ ...base, tlsClientCertPath: "/certs/client.pem" }).success, false);
  assert.equal(connectionInputSchema.safeParse({ ...base, tlsClientKeyPassphrase: "orphaned" }).success, false);
});
