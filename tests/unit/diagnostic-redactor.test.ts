import assert from "node:assert/strict";
import test from "node:test";
import {
  DIAGNOSTIC_REDACTED_VALUE,
  isSensitiveDiagnosticKey,
  redactDiagnosticText,
  redactDiagnosticValue,
} from "../../apps/desktop/src/main/diagnostics/redactor.ts";

test("detects normalized credential and authentication field names without hiding graph keys", () => {
  for (const key of [
    "password",
    "password_cipher",
    "accessToken",
    "Proxy-Authorization",
    "api_key",
    "customHeaders",
    "clientPrivateKey",
    "tlsClientKeyPath",
  ]) {
    assert.equal(isSensitiveDiagnosticKey(key), true, key);
  }
  assert.equal(isSensitiveDiagnosticKey("propertyKey"), false);
  assert.equal(isSensitiveDiagnosticKey("graphName"), false);
});

test("redacts nested credentials, custom headers and authentication maps", () => {
  const input = {
    connection: {
      name: "Production",
      password: "plain-password",
      customHeaders: "{\"Authorization\":\"Bearer header-token\"}",
      nested: [{ access_token: "access-token" }],
    },
    headers: new Map([
      ["Authorization", "Bearer map-token"],
      ["Accept", "application/json"],
    ]),
  };
  const output = redactDiagnosticValue(input);
  const serialized = JSON.stringify(output);

  assert.equal(serialized.includes("plain-password"), false);
  assert.equal(serialized.includes("header-token"), false);
  assert.equal(serialized.includes("access-token"), false);
  assert.equal(serialized.includes("map-token"), false);
  assert.equal(serialized.includes(DIAGNOSTIC_REDACTED_VALUE), true);
  assert.equal(serialized.includes("Production"), true);
});

test("redacts credentials embedded in URLs, headers, JSON and query parameters", () => {
  const output = redactDiagnosticText([
    "wss://janus:super-secret@example.test/gremlin",
    "Authorization: Bearer bearer-value",
    "x-api-key=api-value",
    "{\"password\":\"json-secret\",\"token\":\"json-token\"}",
    "https://example.test/path?token=query-token&mode=read",
  ].join("\n"));

  for (const secret of ["super-secret", "bearer-value", "api-value", "json-secret", "json-token", "query-token"]) {
    assert.equal(output.includes(secret), false, secret);
  }
  assert.equal(output.includes("mode=read"), true);
});

test("removes Gremlin request bodies echoed by long-running server errors", () => {
  const query = "def __graph = ConfiguredGraphFactory.open('graph2'); __graph.io(graphson()).readGraph('/tmp/data.json')";
  const output = redactDiagnosticText(`Evaluation exceeded timeout for request [${query}] (598)`);
  assert.equal(output.includes(query), false);
  assert.equal(output, "Evaluation exceeded timeout for request [[REDACTED]] (598)");
});

test("redacts error stacks, causes and enumerable secret fields", () => {
  const cause = new Error("Authorization: Bearer cause-token");
  const error = new Error("Failed using password=error-password", { cause }) as Error & {
    accessToken: string;
  };
  error.accessToken = "field-token";

  const output = redactDiagnosticValue(error);
  const serialized = JSON.stringify(output);
  for (const secret of ["cause-token", "error-password", "field-token"]) {
    assert.equal(serialized.includes(secret), false, secret);
  }
  assert.match(serialized, /Failed using password=\[REDACTED\]/);
});

test("handles circular objects without throwing or retaining references", () => {
  const input: Record<string, unknown> = { name: "cycle" };
  input.self = input;
  assert.deepEqual(redactDiagnosticValue(input), { name: "cycle", self: "[CIRCULAR]" });
});
