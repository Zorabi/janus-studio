import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import { once } from "node:events";
import test from "node:test";
import type { ConnectionProfile } from "@janusgraph/domain";
import {
  isProxyBypassed,
  openProxyTunnel,
  resolveConnectionProxy,
} from "../../apps/desktop/src/main/services/proxy-support.ts";
import { GremlinService } from "../../apps/desktop/src/main/services/gremlin-service.ts";

const profile: ConnectionProfile = {
  id: "connection-proxy",
  name: "Proxy",
  protocol: "ws",
  host: "graph.internal.example.test",
  port: 8182,
  path: "/gremlin",
  username: "",
  environment: "dev",
  connectionReadOnly: false,
  clientMode: "sessionless",
  traversalSource: "g",
  graphBinding: "graph",
  connectTimeoutMs: 2_000,
  queryTimeoutMs: 30_000,
  tlsRejectUnauthorized: true,
  tlsCaPath: "",
  tlsClientCertPath: "",
  tlsClientKeyPath: "",
  proxyMode: "manual",
  proxyUrl: "http://proxy.example.test:3128",
  proxyHost: "",
  proxyPort: 3128,
  proxyBypass: "",
  proxyUsername: "proxy-user",
  enableCompression: false,
  customHeaders: "{}",
  createdAt: "2026-08-14T00:00:00.000Z",
  updatedAt: "2026-08-14T00:00:00.000Z",
};

test("forces the Gremlin driver onto the ws transport that honors Node connection options", () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "WebSocket");
  Object.defineProperty(globalThis, "WebSocket", {
    configurable: true,
    writable: true,
    value: class NativeWebSocketFixture {},
  });
  try {
    new GremlinService();
    assert.equal("WebSocket" in globalThis, false);
  } finally {
    if (original) Object.defineProperty(globalThis, "WebSocket", original);
    else Reflect.deleteProperty(globalThis, "WebSocket");
  }
});

test("resolves direct, manual and system proxy routes without exposing credentials in the URL", async () => {
  assert.equal(await resolveConnectionProxy({ ...profile, proxyMode: "direct" }, "ws://graph.internal.example.test:8182/gremlin", "secret"), null);
  const manual = await resolveConnectionProxy(profile, "ws://graph.internal.example.test:8182/gremlin", "secret");
  assert.equal(manual?.url.toString(), "http://proxy.example.test:3128/");
  assert.equal(manual?.authorization, `Basic ${Buffer.from("proxy-user:secret").toString("base64")}`);
  assert.equal(manual?.url.username, "");

  const system = await resolveConnectionProxy(
    { ...profile, proxyMode: "system", proxyUsername: "" },
    "ws://graph.internal.example.test:8182/gremlin",
    "",
    async () => "PROXY system-proxy.example.test:8080; DIRECT",
  );
  assert.equal(system?.url.toString(), "http://system-proxy.example.test:8080/");
  assert.equal(system?.source, "system");
});

test("matches proxy bypass hosts, suffixes and wildcards", () => {
  assert.equal(isProxyBypassed("localhost", "localhost,.internal.example.test"), true);
  assert.equal(isProxyBypassed("graph.internal.example.test", "localhost,.internal.example.test"), true);
  assert.equal(isProxyBypassed("api.example.test", "*.example.test"), true);
  assert.equal(isProxyBypassed("example.org", "localhost,.internal.example.test"), false);
});

test("opens an authenticated HTTP CONNECT tunnel", async () => {
  const target = net.createServer((socket) => socket.pipe(socket));
  target.listen(0, "127.0.0.1");
  await once(target, "listening");
  const targetPort = (target.address() as net.AddressInfo).port;
  let proxyAuthorization = "";
  const proxyServer = http.createServer();
  proxyServer.on("connect", (request, clientSocket, head) => {
    proxyAuthorization = String(request.headers["proxy-authorization"] ?? "");
    const upstream = net.connect(targetPort, "127.0.0.1", () => {
      clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head.length > 0) upstream.write(head);
      upstream.pipe(clientSocket);
      clientSocket.pipe(upstream);
    });
  });
  proxyServer.listen(0, "127.0.0.1");
  await once(proxyServer, "listening");
  const proxyPort = (proxyServer.address() as net.AddressInfo).port;
  const tunnel = await openProxyTunnel({
    url: new URL(`http://127.0.0.1:${proxyPort}`),
    authorization: "Basic test-token",
    source: "manual",
  }, "127.0.0.1", targetPort, 2_000);
  try {
    tunnel.write("ping");
    const [data] = await once(tunnel, "data") as [Buffer];
    assert.equal(data.toString(), "ping");
    assert.equal(proxyAuthorization, "Basic test-token");
  } finally {
    tunnel.destroy();
    proxyServer.close();
    target.close();
  }
});

test("reports proxy authentication failures in the proxy diagnostic stage", async () => {
  const proxyServer = http.createServer();
  proxyServer.on("connect", (_request, socket) => {
    socket.end("HTTP/1.1 407 Proxy Authentication Required\r\nContent-Length: 0\r\n\r\n");
  });
  proxyServer.listen(0, "127.0.0.1");
  await once(proxyServer, "listening");
  const proxyPort = (proxyServer.address() as net.AddressInfo).port;
  try {
    const report = await new GremlinService().test({
      ...profile,
      host: "127.0.0.1",
      proxyUrl: `http://127.0.0.1:${proxyPort}`,
    }, "", "", "incorrect");
    assert.equal(report.success, false);
    assert.equal(report.stage, "proxy");
    assert.match(report.message, /407/);
    assert.equal(report.stages.find((stage) => stage.stage === "proxy")?.status, "failed");
  } finally {
    proxyServer.close();
  }
});

test("executes Gremlin HTTP requests through the configured proxy", async () => {
  const target = http.createServer((_request, response) => {
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ result: { data: [42] } }));
  });
  target.listen(0, "127.0.0.1");
  await once(target, "listening");
  const targetPort = (target.address() as net.AddressInfo).port;
  const proxyServer = http.createServer();
  proxyServer.on("connect", (_request, clientSocket, head) => {
    const upstream = net.connect(targetPort, "127.0.0.1", () => {
      clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head.length > 0) upstream.write(head);
      upstream.pipe(clientSocket);
      clientSocket.pipe(upstream);
    });
  });
  proxyServer.listen(0, "127.0.0.1");
  await once(proxyServer, "listening");
  const proxyPort = (proxyServer.address() as net.AddressInfo).port;
  try {
    const result = await new GremlinService().execute({
      ...profile,
      protocol: "http",
      host: "127.0.0.1",
      port: targetPort,
      proxyUrl: `http://127.0.0.1:${proxyPort}`,
      proxyUsername: "",
    }, "", "console", "execution", "1", {}, 2_000, false, "", "");
    assert.deepEqual(result.items, [42]);
  } finally {
    proxyServer.close();
    target.close();
  }
});
