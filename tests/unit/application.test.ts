import assert from "node:assert/strict";
import test from "node:test";
import {
  connectionEndpoint,
  isMutationQuery,
  normalizeManagementConsoleText,
  normalizeTraversalConsoleText,
  withTraversalConsoleText,
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
    environment: "prod",
    connectionReadOnly: true,
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
  assert.equal(normalized.environment, "prod");
  assert.equal(normalized.connectionReadOnly, true);
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

test("detects data and schema mutations without blocking transaction cleanup or schema reads", () => {
  assert.equal(isMutationQuery("g.addV('person').property('name', 'Ada')"), true);
  assert.equal(isMutationQuery("mgmt.makePropertyKey('name').dataType(String.class).make(); mgmt.commit()"), true);
  assert.equal(isMutationQuery("graph.tx().commit()"), true);
  assert.equal(isMutationQuery("graph.tx().rollback()"), false);
  assert.equal(isMutationQuery("graph.openManagement().printSchema()"), false);
  assert.equal(isMutationQuery("g.V().has('note', 'g.addV()') // .drop()"), false);
  assert.equal(
    isMutationQuery("org.janusgraph.core.ConfiguredGraphFactory.create(graphName)"),
    true,
  );
  assert.equal(
    isMutationQuery("org.janusgraph.core.ConfiguredGraphFactory.updateTemplateConfiguration(configuration)"),
    true,
  );
  assert.equal(
    isMutationQuery("org.janusgraph.core.ConfiguredGraphFactory.getGraphNames()"),
    false,
  );
  assert.equal(isMutationQuery("mgmt.forceCloseInstance(instanceId); mgmt.commit()"), true);
  assert.equal(isMutationQuery("graph.io(graphson()).readGraph(serverPath)"), true);
  assert.equal(isMutationQuery("graph.io(graphson()).writeGraph(serverPath)"), false);
});

test("normalizes terminal Profile and Explain queries to Gremlin Console text", () => {
  assert.equal(withTraversalConsoleText("g.V().count()", "profile"), "g.V().count().profile().next().toString()");
  assert.equal(normalizeTraversalConsoleText("g.V().explain()"), "g.V().explain().toString()");
  assert.equal(normalizeTraversalConsoleText("g.V().profile();"), "g.V().profile().next().toString()");
  assert.equal(normalizeTraversalConsoleText("def metrics = g.V().profile(); metrics"), "def metrics = g.V().profile(); metrics");
});

test("keeps openManagement bindings while returning a serializable console summary", () => {
  assert.equal(
    normalizeManagementConsoleText("m = graph3.openManagement()", "sessioned"),
    'm = graph3.openManagement(); [binding: "m", objectType: m.getClass().getName(), state: "open", scope: "session"]',
  );
  assert.match(
    normalizeManagementConsoleText("def management = graph.openManagement();", "sessionless"),
    /binding: "management".*scope: "request"/,
  );
  assert.equal(
    normalizeManagementConsoleText("m = graph.openManagement(); m.printSchema()", "sessioned"),
    "m = graph.openManagement(); m.printSchema()",
  );
  assert.equal(
    normalizeManagementConsoleText("graph3.openManagement()", "sessioned"),
    'def __janusStudioManagement = graph3.openManagement(); try { [objectType: __janusStudioManagement.getClass().getName(), state: "opened-and-rolled-back", reusable: false] } finally { __janusStudioManagement.rollback() }',
  );
});
