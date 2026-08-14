import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import net, { createServer as createTcpServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createServer as createHttpServer } from "node:http";
import { Server as SshServer, utils } from "ssh2";
import type { ConnectionProfile } from "@janusgraph/domain";
import { openApplicationDatabase } from "../../apps/desktop/src/main/storage/database.ts";
import { AuthenticationProfileRepository } from "../../apps/desktop/src/main/storage/authentication-profile-repository.ts";
import { AuthenticationProfileService } from "../../apps/desktop/src/main/services/authentication-profile-service.ts";
import { CredentialVault } from "../../apps/desktop/src/main/security/credential-vault.ts";
import { GremlinService } from "../../apps/desktop/src/main/services/gremlin-service.ts";
import { SshTunnelService, sshHostKeyFingerprint } from "../../apps/desktop/src/main/services/ssh-tunnel-service.ts";
import type { ConnectionRuntimeCredentials } from "../../apps/desktop/src/main/services/connection-service.ts";

function profile(overrides: Partial<ConnectionProfile> = {}): ConnectionProfile {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    name: "Enterprise fixture",
    protocol: "http",
    host: "127.0.0.1",
    port: 8182,
    path: "/gremlin",
    username: "",
    environment: "test",
    connectionReadOnly: false,
    clientMode: "sessionless",
    traversalSource: "g",
    graphBinding: "graph",
    connectTimeoutMs: 5_000,
    queryTimeoutMs: 5_000,
    tlsRejectUnauthorized: true,
    tlsCaPath: "",
    tlsClientCertPath: "",
    tlsClientKeyPath: "",
    proxyMode: "direct",
    proxyUrl: "",
    proxyHost: "",
    proxyPort: 8080,
    proxyBypass: "",
    proxyUsername: "",
    authProfileId: "",
    sshEnabled: false,
    sshHost: "",
    sshPort: 22,
    sshUsername: "",
    sshAuthMode: "private-key",
    sshPrivateKeyPath: "",
    sshAgentPath: "",
    sshHostKeyFingerprint: "",
    enableCompression: false,
    customHeaders: "{}",
    createdAt: "2026-08-14 00:00:00",
    updatedAt: "2026-08-14 00:00:00",
    ...overrides,
  };
}

function credentials(overrides: Partial<ConnectionRuntimeCredentials> = {}): ConnectionRuntimeCredentials {
  return {
    password: "",
    tlsClientKeyPassphrase: "",
    proxyPassword: "",
    sensitiveHeaders: {},
    sshPassword: "",
    sshPrivateKeyPassphrase: "",
    authentication: null,
    ...overrides,
  };
}

test("encrypts reusable authentication profiles without exposing secrets in summaries", async () => {
  const directory = mkdtempSync(join(tmpdir(), "janus-auth-profile-"));
  const database = openApplicationDatabase(join(directory, "app.sqlite"));
  try {
    const service = new AuthenticationProfileService(
      new AuthenticationProfileRepository(database),
      new CredentialVault(join(directory, "vault.key"), true),
    );
    const saved = await service.save({
      name: "Gateway",
      mode: "bearer",
      username: "",
      headerName: "Authorization",
      secret: "token-that-must-not-leak",
      sensitiveHeaders: JSON.stringify({ "X-Tenant-Secret": "tenant-secret" }),
    });
    assert.equal(saved.hasSecret, true);
    assert.equal(saved.hasSensitiveHeaders, true);
    assert.equal(JSON.stringify(service.list()).includes("token-that-must-not-leak"), false);
    const runtime = await service.runtime(saved.id);
    assert.equal(runtime.secret, "token-that-must-not-leak");
    assert.equal(runtime.headers["X-Tenant-Secret"], "tenant-secret");
    const row = database.prepare("SELECT secret_cipher, sensitive_headers_cipher FROM authentication_profiles WHERE id = ?").get(saved.id) as Record<string, unknown>;
    assert.equal(String(row.secret_cipher).includes("token-that-must-not-leak"), false);
    assert.equal(String(row.sensitive_headers_cipher).includes("tenant-secret"), false);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("obtains and reuses an official JanusGraph HMAC token for HTTP requests", async () => {
  let sessionRequests = 0;
  let queryRequests = 0;
  const server = createHttpServer((request, response) => {
    if (request.url === "/session") {
      sessionRequests += 1;
      assert.match(request.headers.authorization ?? "", /^Basic /);
      response.end(JSON.stringify({ token: "signed-session-token" }));
      return;
    }
    queryRequests += 1;
    assert.equal(request.headers.authorization, "Token signed-session-token");
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ result: { data: [1] } }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const service = new GremlinService();
  const connection = profile({ port: address.port });
  const runtime = credentials({ authentication: { mode: "janus-hmac", username: "janusgraph", secret: "secret", headerName: "Authorization", headers: {} } });
  try {
    await service.execute(connection, runtime, "console", "request-1", "1", {});
    await service.execute(connection, runtime, "console", "request-2", "1", {});
    assert.equal(sessionRequests, 1);
    assert.equal(queryRequests, 2);
  } finally {
    await service.closeAll();
    server.close();
  }
});

test("forwards traffic through SSH only after strict host-key verification", async () => {
  const echo = createTcpServer((socket) => socket.pipe(socket));
  await new Promise<void>((resolve) => echo.listen(0, "127.0.0.1", resolve));
  const echoAddress = echo.address();
  assert.ok(echoAddress && typeof echoAddress !== "string");
  const { privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs1", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });
  const parsed = utils.parseKey(privateKey);
  assert.ok(!(parsed instanceof Error) && !Array.isArray(parsed));
  const fingerprint = sshHostKeyFingerprint(parsed.getPublicSSH());
  let disconnectSsh: () => Promise<void> = async () => undefined;
  let sshConnectionCount = 0;
  const ssh = new SshServer({ hostKeys: [privateKey] }, (client) => {
    sshConnectionCount += 1;
    disconnectSsh = async () => {
      const closed = new Promise<void>((resolve) => client.once("close", resolve));
      client.end();
      await closed;
    };
    client.on("error", () => undefined);
    client.on("authentication", (context) => {
      if (context.method === "password" && context.username === "studio" && context.password === "ssh-secret") context.accept();
      else context.reject();
    });
    client.on("ready", () => client.on("tcpip", (accept, reject, info) => {
      const channel = accept();
      if (!channel) { reject(); return; }
      const upstream = net.connect(info.destPort, info.destIP, () => {
        channel.pipe(upstream);
        upstream.pipe(channel);
      });
      upstream.once("error", () => channel.close());
    }));
  });
  await new Promise<void>((resolve) => ssh.listen(0, "127.0.0.1", resolve));
  const sshAddress = ssh.address();
  assert.ok(sshAddress && typeof sshAddress !== "string");
  const connection = profile({
    protocol: "ws",
    port: echoAddress.port,
    sshEnabled: true,
    sshHost: "127.0.0.1",
    sshPort: sshAddress.port,
    sshUsername: "studio",
    sshAuthMode: "password",
    sshHostKeyFingerprint: fingerprint,
  });
  const runtime = credentials({ sshPassword: "ssh-secret" });
  const tunnels = new SshTunnelService();
  const observedStatuses: string[] = [];
  const unsubscribe = tunnels.subscribe((connectionId, snapshot) => {
    if (connectionId === connection.id) observedStatuses.push(snapshot.status);
  });
  try {
    const [routed, concurrentRoute] = await Promise.all([
      tunnels.route(connection, runtime),
      tunnels.route(connection, runtime),
    ]);
    assert.equal(concurrentRoute.port, routed.port);
    assert.equal(sshConnectionCount, 1);
    const received = await new Promise<string>((resolve, reject) => {
      const socket = net.connect(routed.port, routed.host, () => socket.write("through-ssh"));
      socket.once("data", (data) => { resolve(data.toString()); socket.destroy(); });
      socket.once("error", reject);
    });
    assert.equal(received, "through-ssh");
    assert.equal(tunnels.snapshot(connection.id).status, "connected");
    assert.equal(tunnels.snapshot(connection.id).localPort, routed.port);
    assert.ok(tunnels.snapshot(connection.id).connectedAt);

    await disconnectSsh();
    for (let attempt = 0; attempt < 20 && tunnels.snapshot(connection.id).status !== "disconnected"; attempt += 1) {
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    assert.equal(tunnels.snapshot(connection.id).status, "disconnected");
    assert.ok(tunnels.snapshot(connection.id).disconnectedAt);
    const reconnected = await tunnels.route(connection, runtime);
    assert.equal(tunnels.snapshot(connection.id).status, "connected");
    assert.equal(tunnels.snapshot(connection.id).reconnectCount, 1);
    assert.equal(sshConnectionCount, 2);

    const heldSocket = net.connect(reconnected.port, reconnected.host);
    await once(heldSocket, "connect");
    heldSocket.on("error", () => undefined);
    const heldSocketClosed = new Promise<void>((resolve) => heldSocket.once("close", resolve));
    await tunnels.close(connection.id);
    await heldSocketClosed;
    assert.deepEqual(tunnels.snapshot(connection.id), { status: "inactive" });
    assert.deepEqual(observedStatuses, ["connecting", "connected", "disconnected", "reconnecting", "connected", "inactive"]);

    const rejectedTunnels = new SshTunnelService();
    const rejectedConnection = { ...connection, id: "22222222-2222-4222-8222-222222222222", sshHostKeyFingerprint: `SHA256:${"A".repeat(43)}` };
    await assert.rejects(
      rejectedTunnels.route(rejectedConnection, runtime),
      /主机密钥不匹配/,
    );
    assert.equal(rejectedTunnels.snapshot(rejectedConnection.id).status, "failed");
    assert.match(rejectedTunnels.snapshot(rejectedConnection.id).lastError ?? "", /主机密钥不匹配/);
    await rejectedTunnels.closeAll();
  } finally {
    unsubscribe();
    await tunnels.closeAll();
    ssh.close();
    echo.close();
  }
});
