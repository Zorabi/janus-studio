import assert from "node:assert/strict";
import test from "node:test";
import {
  configurationToRows,
  GRAPH_FACTORY_PROBE_QUERY,
  GRAPH_FACTORY_QUERIES,
  isProtectedConfigurationKey,
  isSensitiveConfigurationKey,
  duplicateGraphInstanceId,
  parseGraphFactoryState,
  parseGraphInstanceSnapshot,
  parseGraphInstanceSessions,
  rowsToConfiguration,
  validateGraphName,
} from "../../apps/desktop/src/renderer/lib/configured-graph-factory.ts";
import {
  connectionWithGraphContext,
  dynamicGraphContext,
  graphContextForConnection,
  graphContextFromQueryTab,
} from "../../apps/desktop/src/renderer/lib/dynamic-graph-context.ts";

test("parses graph factory inventory and template configuration", () => {
  const state = parseGraphFactoryState([{
    graphs: [
      {
        name: "orders",
        graphBinding: "orders",
        traversalSource: "orders_traversal",
        configuration: {
          "storage.backend": "cql",
          "storage.hostname": ["db-1", "db-2"],
        },
      },
      {
        name: "analytics",
        configuration: { "storage.backend": "inmemory" },
      },
    ],
    templateConfiguration: {
      "storage.backend": "cql",
      "schema.default": "none",
    },
  }]);

  assert.ok(state);
  assert.deepEqual(state.graphs.map((graph) => graph.name), ["analytics", "orders"]);
  assert.equal(state.graphs[0]?.traversalSource, "analytics_traversal");
  assert.deepEqual(state.templateConfiguration, {
    "storage.backend": "cql",
    "schema.default": "none",
  });
});

test("marks configurations copied from the template", () => {
  const state = parseGraphFactoryState([{
    graphs: [{
      name: "graph1",
      configuration: {
        Created_Using_Template: true,
        "storage.backend": "cql",
      },
    }],
    templateConfiguration: null,
  }]);

  assert.equal(state?.graphs[0]?.createdUsingTemplate, true);
});

test("merges top-level Map entries split into separate Gremlin results", () => {
  const state = parseGraphFactoryState([
    {
      graphs: [{
        name: "graph1",
        configuration: { "storage.backend": "cql" },
      }],
    },
    {
      templateConfiguration: [
        { "index.search.hostname": "82.157.17.54" },
        { "index.search.port": 30180 },
      ],
    },
  ]);

  assert.ok(state);
  assert.deepEqual(state.templateConfiguration, {
    "index.search.hostname": "82.157.17.54",
    "index.search.port": 30180,
  });
});

test("unwraps the single-item list used to preserve a snapshot Map", () => {
  const state = parseGraphFactoryState([[
    {
      graphs: [],
      templateConfiguration: { "storage.backend": "cql" },
    },
  ]]);

  assert.deepEqual(state?.templateConfiguration, { "storage.backend": "cql" });
});

test("parses GraphSON maps returned over HTTP", () => {
  const state = parseGraphFactoryState([{
    "@type": "g:Map",
    "@value": [
      "graphs",
      {
        "@type": "g:List",
        "@value": [{
          "@type": "g:Map",
          "@value": [
            "name", "tenant-a",
            "traversalSource", "tenant-a_traversal",
            "configuration", {
              "@type": "g:Map",
              "@value": ["storage.backend", "cql"],
            },
          ],
        }],
      },
      "templateConfiguration", null,
    ],
  }]);

  assert.ok(state);
  assert.equal(state.graphs[0]?.name, "tenant-a");
  assert.deepEqual(state.graphs[0]?.configuration, { "storage.backend": "cql" });
  assert.equal(state.templateConfiguration, null);
});

test("round-trips typed configuration rows without flattening values", () => {
  const configuration = {
    "storage.backend": "cql",
    "storage.port": 9042,
    "storage.batch-loading": true,
    "storage.hostname": ["db-1", "db-2"],
  };
  const rows = configurationToRows(configuration);

  assert.deepEqual(rowsToConfiguration(rows), configuration);
});

test("validates graph names and detects sensitive configuration keys", () => {
  assert.equal(validateGraphName(" tenant-a.2026 "), "tenant-a.2026");
  assert.throws(() => validateGraphName("tenant a"), /只能包含/);
  assert.equal(isSensitiveConfigurationKey("storage.cql.password"), true);
  assert.equal(isSensitiveConfigurationKey("index.search.backend"), false);
  assert.equal(isProtectedConfigurationKey("Created_Using_Template"), true);
  assert.equal(isProtectedConfigurationKey("graph.graphname"), true);
});

test("parses current and remote JanusGraph instance sessions", () => {
  const sessions = parseGraphInstanceSessions([[
    { id: "node-a", current: true },
    { id: "node-b", current: false },
  ]]);

  assert.deepEqual(sessions, [
    { id: "node-a", current: true },
    { id: "node-b", current: false },
  ]);
});

test("parses an instance snapshot without forcing a graph open", () => {
  assert.deepEqual(parseGraphInstanceSnapshot([[{
    available: true,
    sessions: [
      { id: "node-a", current: true },
      { id: "node-b", current: false },
    ],
  }]]), {
    available: true,
    sessions: [
      { id: "node-a", current: true },
      { id: "node-b", current: false },
    ],
  });
  assert.deepEqual(parseGraphInstanceSnapshot([[{ available: false, sessions: [] }]]), {
    available: false,
    sessions: [],
  });
});

test("extracts a duplicate JanusGraph instance id from a server error", () => {
  assert.equal(
    duplicateGraphInstanceId("A JanusGraph graph with the same instance id [5a9db74e73ab] is already open."),
    "5a9db74e73ab",
  );
  assert.equal(duplicateGraphInstanceId("Connection refused"), null);
});

test("carries a dynamic graph context between query and schema without mutating the connection", () => {
  const context = dynamicGraphContext("connection-1", {
    name: "graph2",
    graphBinding: "graph2",
    traversalSource: "graph2_traversal",
  });
  assert.deepEqual(graphContextFromQueryTab({
    connectionId: "connection-1",
    graphBindingOverride: "graph2",
    traversalSourceOverride: "graph2_traversal",
  }), context);
  assert.equal(graphContextForConnection(context, "connection-2"), null);
  const connection = {
    id: "connection-1",
    graphBinding: "graph",
    traversalSource: "g",
  } as Parameters<typeof connectionWithGraphContext>[0];
  assert.deepEqual(connectionWithGraphContext(connection, context), {
    ...connection,
    graphBinding: "graph2",
    traversalSource: "graph2_traversal",
  });
  assert.equal(connection?.graphBinding, "graph");
});

test("uses bindings for every graph name and configuration mutation", () => {
  assert.match(GRAPH_FACTORY_PROBE_QUERY, /getGraphNames/);
  assert.match(GRAPH_FACTORY_PROBE_QUERY, /return \[\[/);
  assert.match(GRAPH_FACTORY_QUERIES.createGraph, /create\(graphName\)/);
  assert.match(GRAPH_FACTORY_QUERIES.reloadGraph, /getGraph\(graphName\)/);
  assert.match(GRAPH_FACTORY_QUERIES.reloadGraph, /close\(graphName\)/);
  assert.match(GRAPH_FACTORY_QUERIES.reloadGraph, /open\(graphName\)/);
  assert.match(GRAPH_FACTORY_QUERIES.reloadGraph, /reloaded: true/);
  assert.match(GRAPH_FACTORY_QUERIES.closeGraph, /close\(graphName\)/);
  assert.match(GRAPH_FACTORY_QUERIES.createConfiguration, /createConfiguration/);
  assert.match(GRAPH_FACTORY_QUERIES.createConfiguration, /getConfiguration\(graphName\)/);
  assert.match(GRAPH_FACTORY_QUERIES.createConfiguration, /open\(graphName\)/);
  assert.match(GRAPH_FACTORY_QUERIES.createConfiguration, /opened: true/);
  assert.match(GRAPH_FACTORY_QUERIES.updateConfiguration, /new LinkedHashMap\(configuration\)/);
  assert.match(GRAPH_FACTORY_QUERIES.updateConfiguration, /removeConfiguration\(graphName, __removedKeys\)/);
  assert.match(GRAPH_FACTORY_QUERIES.updateConfiguration, /getConfiguration\(graphName\)/);
  assert.match(GRAPH_FACTORY_QUERIES.updateConfiguration, /Graph configuration verification failed/);
  assert.match(GRAPH_FACTORY_QUERIES.dropGraph, /DROP_PREFLIGHT_REQUIRED/);
  assert.match(GRAPH_FACTORY_QUERIES.dropGraph, /DROP_BLOCKED_OPEN_INSTANCES/);
  assert.match(GRAPH_FACTORY_QUERIES.dropGraph, /drop\(graphName\)/);
  assert.doesNotMatch(GRAPH_FACTORY_QUERIES.dropGraph, /close\(graphName\)/);
  assert.match(GRAPH_FACTORY_QUERIES.dropGraph, /Thread\.sleep\(250\)/);
  assert.match(GRAPH_FACTORY_QUERIES.dropGraph, /DROP_VERIFICATION_FAILED/);
  assert.doesNotMatch(GRAPH_FACTORY_QUERIES.dropGraph, /ConfiguredGraphFactory\.open/);
  assert.equal(Object.hasOwn(GRAPH_FACTORY_QUERIES, "removeConfiguration"), false);
  assert.match(GRAPH_FACTORY_QUERIES.forceCloseInstance, /forceCloseInstance\(instanceId\)/);
  assert.match(GRAPH_FACTORY_QUERIES.forceCloseOtherInstances, /getOpenInstances\(\)/);
  assert.match(GRAPH_FACTORY_QUERIES.forceCloseOtherInstances, /!__raw\.endsWith\("\(current\)"\)/);
  assert.match(GRAPH_FACTORY_QUERIES.forceCloseOtherInstances, /__management\.commit\(\)/);
  assert.match(GRAPH_FACTORY_QUERIES.listInstances, /JanusGraphManagerUtility\.getInstance\(\)/);
  assert.match(GRAPH_FACTORY_QUERIES.listInstances, /available: false/);
  assert.doesNotMatch(GRAPH_FACTORY_QUERIES.listInstances, /ConfiguredGraphFactory\.open/);
  assert.doesNotMatch(GRAPH_FACTORY_QUERIES.createGraph, /tenant-a/);
});
