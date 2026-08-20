import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer as createHttpServer } from "node:http";
import { createServer as createHttpsServer, type Server as HttpsServer } from "node:https";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { WebSocketServer } from "ws";
import type { ConnectionProfile } from "@janusgraph/domain";
import type { ConnectionRuntimeCredentials } from "../../apps/desktop/src/main/services/connection-service.ts";
import { GremlinService } from "../../apps/desktop/src/main/services/gremlin-service.ts";
import { createMtlsFixture, type MtlsFixture } from "../helpers/mtls-fixture.ts";
import { startSshForwarderFixture } from "../helpers/ssh-forwarder-fixture.ts";

type MaterialPaths = {
  ca: string;
  clientCertificate: string;
  clientPrivateKey: string;
  encryptedClientPrivateKey: string;
};

function writeMaterial(directory: string, fixture: MtlsFixture): MaterialPaths {
  const paths = {
    ca: join(directory, "ca.pem"),
    clientCertificate: join(directory, "client.pem"),
    clientPrivateKey: join(directory, "client-key.pem"),
    encryptedClientPrivateKey: join(directory, "client-key-encrypted.pem"),
  };
  writeFileSync(paths.ca, fixture.caCertificate);
  writeFileSync(paths.clientCertificate, fixture.clientCertificate);
  writeFileSync(paths.clientPrivateKey, fixture.clientPrivateKey);
  writeFileSync(paths.encryptedClientPrivateKey, fixture.encryptedClientPrivateKey);
  return paths;
}

function profile(protocol: "https" | "wss", port: number, material: MaterialPaths): ConnectionProfile {
  return {
    id: `11111111-1111-4111-8111-${protocol === "https" ? "111111111111" : "222222222222"}`,
    name: `mTLS ${protocol}`,
    protocol,
    host: "127.0.0.1",
    port,
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
    tlsCaPath: material.ca,
    tlsClientCertPath: material.clientCertificate,
    tlsClientKeyPath: material.clientPrivateKey,
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
  };
}

function credentials(passphrase = ""): ConnectionRuntimeCredentials {
  return {
    password: "",
    tlsClientKeyPassphrase: passphrase,
    proxyPassword: "",
    sensitiveHeaders: {},
    sshPassword: "",
    sshPrivateKeyPassphrase: "",
    authentication: null,
  };
}

async function listen(server: HttpsServer): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return address.port;
}

async function closeHttps(server: HttpsServer): Promise<void> {
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

async function startConnectProxy(targetPort: number): Promise<{
  port: number;
  tunnelCount: () => number;
  close: () => Promise<void>;
}> {
  const sockets = new Set<net.Socket>();
  let tunnels = 0;
  const server = createHttpServer();
  server.on("connect", (_request, clientSocket, head) => {
    tunnels += 1;
    const upstream = net.connect(targetPort, "127.0.0.1", () => {
      clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head.length > 0) upstream.write(head);
      upstream.pipe(clientSocket);
      clientSocket.pipe(upstream);
    });
    sockets.add(clientSocket);
    sockets.add(upstream);
    const release = (socket: net.Socket) => () => sockets.delete(socket);
    clientSocket.once("close", release(clientSocket));
    upstream.once("close", release(upstream));
    upstream.once("error", () => clientSocket.destroy());
    clientSocket.once("error", () => upstream.destroy());
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return {
    port: address.port,
    tunnelCount: () => tunnels,
    close: async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

test("executes HTTPS Gremlin requests with a trusted CA and encrypted mTLS client key", async () => {
  const directory = mkdtempSync(join(tmpdir(), "janus-mtls-https-"));
  const fixture = createMtlsFixture();
  const material = writeMaterial(directory, fixture);
  let authorizedRequests = 0;
  const server = createHttpsServer({
    key: fixture.serverPrivateKey,
    cert: fixture.serverCertificate,
    ca: fixture.caCertificate,
    requestCert: true,
    rejectUnauthorized: true,
  }, (request, response) => {
    request.resume();
    if (request.socket.authorized) authorizedRequests += 1;
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ result: { data: [true] } }));
  });
  const service = new GremlinService();
  try {
    const port = await listen(server);
    const connection = {
      ...profile("https", port, material),
      tlsClientKeyPath: material.encryptedClientPrivateKey,
    };
    const report = await service.test(connection, credentials(fixture.clientPassphrase));
    assert.equal(report.success, true, JSON.stringify(report));
    assert.equal(report.stages.find((stage) => stage.stage === "tls")?.status, "passed");
    assert.ok(authorizedRequests >= 2);
  } finally {
    await service.closeAll();
    await closeHttps(server);
    rmSync(directory, { recursive: true, force: true });
  }
});

test("executes WSS Gremlin requests with mTLS client authentication", async () => {
  const directory = mkdtempSync(join(tmpdir(), "janus-mtls-wss-"));
  const fixture = createMtlsFixture();
  const material = writeMaterial(directory, fixture);
  const server = createHttpsServer({
    key: fixture.serverPrivateKey,
    cert: fixture.serverCertificate,
    ca: fixture.caCertificate,
    requestCert: true,
    rejectUnauthorized: true,
  });
  const webSockets = new WebSocketServer({ server, path: "/gremlin" });
  let authorizedConnections = 0;
  const requestIds: string[] = [];
  webSockets.on("connection", (socket, request) => {
    if (request.socket.authorized) authorizedConnections += 1;
    socket.on("message", (raw) => {
      const message = Buffer.isBuffer(raw) ? raw : Buffer.from(raw as ArrayBuffer);
      const mimeLength = message[0] ?? 0;
      const requestBody = JSON.parse(message.subarray(mimeLength + 1).toString()) as {
        requestId: { "@value": string };
      };
      requestIds.push(requestBody.requestId["@value"]);
      socket.send(JSON.stringify({
        requestId: requestBody.requestId["@value"],
        status: { code: 200, message: "", attributes: {} },
        result: { data: [true], meta: {} },
      }));
    });
  });
  const service = new GremlinService();
  try {
    const port = await listen(server);
    const report = await service.test(profile("wss", port, material), credentials());
    assert.equal(report.success, true, JSON.stringify(report));
    assert.equal(report.stages.find((stage) => stage.stage === "tls")?.status, "passed");
    assert.ok(authorizedConnections >= 2);
    await service.execute(
      profile("wss", port, material),
      credentials(),
      "quality-run",
      "quality:run-id:rule-0",
      "1",
      {},
      5_000,
      true,
    );
    assert.match(
      requestIds.at(-1) ?? "",
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      "semantic application execution ids must not be sent as Gremlin protocol request ids",
    );
  } finally {
    await service.closeAll();
    for (const client of webSockets.clients) client.terminate();
    await new Promise<void>((resolve) => webSockets.close(() => resolve()));
    await closeHttps(server);
    rmSync(directory, { recursive: true, force: true });
  }
});

test("preserves mTLS verification through an SSH Tunnel", async () => {
  const directory = mkdtempSync(join(tmpdir(), "janus-mtls-ssh-"));
  const fixture = createMtlsFixture();
  const material = writeMaterial(directory, fixture);
  let authorizedRequests = 0;
  const server = createHttpsServer({
    key: fixture.serverPrivateKey,
    cert: fixture.serverCertificate,
    ca: fixture.caCertificate,
    requestCert: true,
    rejectUnauthorized: true,
  }, (request, response) => {
    request.resume();
    if (request.socket.authorized) authorizedRequests += 1;
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ result: { data: [true] } }));
  });
  const ssh = await startSshForwarderFixture();
  const service = new GremlinService();
  try {
    const port = await listen(server);
    const connection: ConnectionProfile = {
      ...profile("https", port, material),
      id: "33333333-3333-4333-8333-333333333333",
      sshEnabled: true,
      sshHost: ssh.host,
      sshPort: ssh.port,
      sshUsername: ssh.username,
      sshAuthMode: "password",
      sshHostKeyFingerprint: ssh.fingerprint,
    };
    const report = await service.test(connection, {
      ...credentials(),
      sshPassword: ssh.password,
    });
    assert.equal(report.success, true, JSON.stringify(report));
    assert.equal(report.stages.find((stage) => stage.stage === "ssh")?.status, "passed");
    assert.equal(report.stages.find((stage) => stage.stage === "tls")?.status, "passed");
    assert.ok(authorizedRequests >= 2);
  } finally {
    await service.closeAll();
    await ssh.close();
    await closeHttps(server);
    rmSync(directory, { recursive: true, force: true });
  }
});

test("preserves mTLS client authentication through an HTTP CONNECT proxy", async () => {
  const directory = mkdtempSync(join(tmpdir(), "janus-mtls-proxy-"));
  const fixture = createMtlsFixture();
  const material = writeMaterial(directory, fixture);
  let authorizedRequests = 0;
  const server = createHttpsServer({
    key: fixture.serverPrivateKey,
    cert: fixture.serverCertificate,
    ca: fixture.caCertificate,
    requestCert: true,
    rejectUnauthorized: true,
  }, (request, response) => {
    request.resume();
    if (request.socket.authorized) authorizedRequests += 1;
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ result: { data: [true] } }));
  });
  const service = new GremlinService();
  let proxy: Awaited<ReturnType<typeof startConnectProxy>> | null = null;
  try {
    const port = await listen(server);
    proxy = await startConnectProxy(port);
    const connection: ConnectionProfile = {
      ...profile("https", port, material),
      id: "44444444-4444-4444-8444-444444444444",
      proxyMode: "manual",
      proxyUrl: `http://127.0.0.1:${proxy.port}`,
    };
    const report = await service.test(connection, credentials());
    assert.equal(report.success, true, JSON.stringify(report));
    assert.equal(report.stages.find((stage) => stage.stage === "proxy")?.status, "passed");
    assert.equal(report.stages.find((stage) => stage.stage === "tls")?.status, "passed");
    assert.ok(proxy.tunnelCount() >= 3);
    assert.ok(authorizedRequests >= 2);
  } finally {
    await service.closeAll();
    await proxy?.close();
    await closeHttps(server);
    rmSync(directory, { recursive: true, force: true });
  }
});

test("classifies untrusted CA, missing client certificate and wrong key passphrase as TLS failures", async () => {
  const directory = mkdtempSync(join(tmpdir(), "janus-mtls-failures-"));
  const fixture = createMtlsFixture();
  const material = writeMaterial(directory, fixture);
  const server = createHttpsServer({
    key: fixture.serverPrivateKey,
    cert: fixture.serverCertificate,
    ca: fixture.caCertificate,
    requestCert: true,
    rejectUnauthorized: true,
  }, (request, response) => {
    request.resume();
    response.end(JSON.stringify({ result: { data: [true] } }));
  });
  const service = new GremlinService();
  try {
    const port = await listen(server);
    const base = profile("https", port, material);
    const untrusted = await service.test({ ...base, tlsCaPath: "" }, credentials());
    assert.equal(untrusted.success, false);
    assert.equal(untrusted.stage, "tls");

    const missingClient = await service.test({ ...base, tlsClientCertPath: "", tlsClientKeyPath: "" }, credentials());
    assert.equal(missingClient.success, false);
    assert.equal(missingClient.stage, "tls", JSON.stringify(missingClient));

    const wrongPassphrase = await service.test({ ...base, tlsClientKeyPath: material.encryptedClientPrivateKey }, credentials("wrong-passphrase"));
    assert.equal(wrongPassphrase.success, false);
    assert.equal(wrongPassphrase.stage, "tls");
  } finally {
    await service.closeAll();
    await closeHttps(server);
    rmSync(directory, { recursive: true, force: true });
  }
});
