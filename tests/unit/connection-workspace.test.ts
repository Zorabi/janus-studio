import assert from "node:assert/strict";
import test from "node:test";
import type { ConnectionSummary } from "@janusgraph/domain";
import {
  createConnectionWorkspaceArchive,
  connectionImportInput,
  parseConnectionWorkspaceArchive,
  planConnectionWorkspaceImport,
} from "../../apps/desktop/src/renderer/lib/connection-workspace";

function connection(overrides: Partial<ConnectionSummary> = {}): ConnectionSummary {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    name: "Local graph",
    protocol: "ws",
    host: "127.0.0.1",
    port: 8182,
    path: "/gremlin",
    username: "janusgraph",
    environment: "dev",
    connectionReadOnly: false,
    clientMode: "sessionless",
    traversalSource: "graph1_traversal",
    graphBinding: "graph1",
    connectTimeoutMs: 10_000,
    queryTimeoutMs: 30_000,
    tlsRejectUnauthorized: true,
    tlsCaPath: "/Users/example/ca.pem",
    tlsClientCertPath: "/Users/example/client.pem",
    tlsClientKeyPath: "/Users/example/client.key",
    proxyMode: "direct",
    proxyUrl: "http://proxy-user:proxy-secret@proxy.example.com:3128/private?token=hidden",
    proxyHost: "",
    proxyPort: 8080,
    proxyBypass: "",
    proxyUsername: "",
    authProfileId: "22222222-2222-4222-8222-222222222222",
    sshEnabled: true,
    sshHost: "bastion.example.com",
    sshPort: 22,
    sshUsername: "operator",
    sshAuthMode: "private-key",
    sshPrivateKeyPath: "/Users/example/.ssh/id_ed25519",
    sshAgentPath: "",
    sshHostKeyFingerprint: "SHA256:0000000000000000000000000000000000000000000",
    enableCompression: true,
    customHeaders: JSON.stringify({ "X-Tenant": "blue", Authorization: "secret" }),
    groupName: "Local",
    accentColor: "#83bcff",
    tags: ["dev", "graph1"],
    lastUsedAt: "2026-08-14T01:02:03.000Z",
    createdAt: "2026-08-13T01:02:03.000Z",
    updatedAt: "2026-08-14T01:02:03.000Z",
    hasPassword: true,
    hasTlsClientKeyPassphrase: true,
    hasProxyPassword: false,
    hasSensitiveHeaders: true,
    hasSshPassword: false,
    hasSshPrivateKeyPassphrase: true,
    ...overrides,
  };
}

test("exports portable connection workspaces without credentials or machine-local paths", () => {
  const archive = createConnectionWorkspaceArchive([connection()]);
  const text = JSON.stringify(archive);
  const exported = archive.connections[0]!;
  assert.equal(archive.credentialsIncluded, false);
  assert.equal(exported.input.authProfileId, "");
  assert.equal(exported.input.proxyUrl, "");
  assert.equal(exported.input.proxyHost, "proxy.example.com");
  assert.equal(exported.input.proxyPort, 3128);
  assert.equal(exported.input.sshEnabled, false);
  assert.equal(exported.input.sshPrivateKeyPath, "");
  assert.equal(exported.input.tlsClientKeyPath, "");
  assert.deepEqual(JSON.parse(exported.input.customHeaders), {});
  assert.deepEqual(exported.credentialKinds, ["password", "authentication-profile", "mtls", "sensitive-headers", "custom-headers", "ssh"]);
  assert.doesNotMatch(text, /client\.key|id_ed25519|Authorization|X-Tenant|secret|hidden|proxy-user|blue/);
});

test("rejects archives that attempt to inject credential fields", () => {
  const archive = createConnectionWorkspaceArchive([connection()]);
  const poisoned = structuredClone(archive) as unknown as { connections: Array<{ input: Record<string, unknown> }> };
  poisoned.connections[0]!.input.password = "not-allowed";
  assert.throws(() => parseConnectionWorkspaceArchive(JSON.stringify(poisoned)), /禁止导入的凭据字段/);
});

test("plans create, update, skip and same-name conflicts without overwriting ambiguous targets", () => {
  const existing = connection({ tlsCaPath: "", tlsClientCertPath: "", tlsClientKeyPath: "", authProfileId: "", sshEnabled: false, sshPrivateKeyPath: "", hasPassword: false, hasTlsClientKeyPassphrase: false, hasSensitiveHeaders: false, hasSshPrivateKeyPassphrase: false });
  const unchanged = createConnectionWorkspaceArchive([existing]).connections[0]!;
  const updated = structuredClone(unchanged);
  updated.input.groupName = "Updated";
  const created = structuredClone(unchanged);
  created.sourceId = "33333333-3333-4333-8333-333333333333";
  created.input.name = "Remote graph";
  created.input.host = "remote.example.com";
  const conflict = structuredClone(unchanged);
  conflict.sourceId = "44444444-4444-4444-8444-444444444444";
  conflict.input.host = "other.example.com";
  const empty = createConnectionWorkspaceArchive([]);
  const statuses = [unchanged, updated, created, conflict].map((entry) =>
    planConnectionWorkspaceImport({ ...empty, connections: [entry] }, [existing])[0]!.status);
  assert.deepEqual(statuses, ["skip", "update", "create", "conflict"]);
  const updateRow = planConnectionWorkspaceImport({ ...empty, connections: [updated] }, [existing])[0]!;
  const input = connectionImportInput(updateRow);
  assert.equal(input.id, existing.id);
  assert.equal(input.groupName, "Updated");
  assert.equal(input.tlsClientKeyPath, existing.tlsClientKeyPath);
  assert.equal(input.sshEnabled, existing.sshEnabled);
  assert.equal(input.customHeaders, existing.customHeaders);
});
