import assert from "node:assert/strict";
import test from "node:test";
import {
  connectionEndpoint,
  isSecureConnection,
  normalizeConnectionInput,
} from "../../packages/application/src/index.ts";

test("normalizes connection profiles without changing security choices", () => {
  const normalized = normalizeConnectionInput({
    name: "  Local  ",
    protocol: "wss",
    host: " graph.example.test ",
    port: 8182,
    path: "gremlin",
    username: " admin ",
    password: "secret",
    clientMode: "sessionless",
    traversalSource: " ",
    graphBinding: " ",
    connectTimeoutMs: 5_000,
    queryTimeoutMs: 30_000,
    tlsRejectUnauthorized: false,
    enableCompression: true,
    customHeaders: "  {\"X-Test\":\"1\"}  ",
  });

  assert.equal(normalized.name, "Local");
  assert.equal(normalized.host, "graph.example.test");
  assert.equal(normalized.path, "gremlin");
  assert.equal(normalized.username, "admin");
  assert.equal(normalized.traversalSource, "g");
  assert.equal(normalized.graphBinding, "graph");
  assert.equal(normalized.tlsRejectUnauthorized, false);
  assert.equal(normalized.enableCompression, true);
  assert.equal(normalized.customHeaders, "{\"X-Test\":\"1\"}");
});

test("renders endpoints and identifies secure protocols", () => {
  assert.equal(
    connectionEndpoint({ protocol: "https", host: "localhost", port: 8182, path: "gremlin" }),
    "https://localhost:8182/gremlin",
  );
  assert.equal(isSecureConnection("wss"), true);
  assert.equal(isSecureConnection("https"), true);
  assert.equal(isSecureConnection("ws"), false);
  assert.equal(isSecureConnection("http"), false);
});
