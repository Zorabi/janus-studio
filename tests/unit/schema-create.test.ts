import assert from "node:assert/strict";
import test from "node:test";
import {
  buildExistingPropertyIndexScript,
  buildPropertyKeySchemaScript,
  sortSchemaNames,
} from "../../apps/desktop/src/renderer/lib/schema-create.ts";

test("sorts Vertex and Edge label choices in natural numeric order", () => {
  assert.deepEqual(
    sortSchemaNames(["v111", "v10", "v2", "v1", "V3"]),
    ["v1", "v2", "V3", "v10", "v111"],
  );
  assert.deepEqual(sortSchemaNames(["e20", "e1", "e11", "e2"]), ["e1", "e2", "e11", "e20"]);
});

test("creates a property key without colliding with the Gremlin T.key token", () => {
  const script = buildPropertyKeySchemaScript({
    graphBinding: "graph",
    name: "p999",
    dataType: "String",
    cardinality: "SINGLE",
    element: "Vertex",
  });

  assert.match(script, /def __propertyKey = __management\.makePropertyKey\("p999"\)/);
  assert.doesNotMatch(script, /(?:^|\n)key\s*=/);
  assert.doesNotMatch(script, /\.addKey\(key\)/);
});

test("limits synchronized composite and mixed indexes to a Vertex Label", () => {
  const script = buildPropertyKeySchemaScript({
    graphBinding: "graph",
    name: "email",
    dataType: "String",
    cardinality: "SINGLE",
    element: "Vertex",
    schemaLabel: "person",
    composite: { name: "email_c", unique: true },
    mixed: { name: "email_m", backend: "search" },
  });

  assert.match(script, /getVertexLabel\("person"\)/);
  assert.match(script, /__compositeBuilder\.indexOnly\(__indexOnlyLabel\)/);
  assert.match(script, /__mixedBuilder\.indexOnly\(__indexOnlyLabel\)/);
  assert.match(script, /__compositeBuilder\.unique\(\)/);
  assert.match(script, /__mixedBuilder\.buildMixedIndex\("search"\)/);
});

test("limits indexes for existing properties to Vertex or Edge labels", () => {
  const vertexScript = buildExistingPropertyIndexScript({
    graphBinding: "graph",
    indexName: "byName",
    propertyKey: "name",
    type: "composite",
    element: "Vertex",
    schemaLabel: "person",
    unique: false,
    backend: "search",
  });
  const edgeScript = buildExistingPropertyIndexScript({
    graphBinding: "graph",
    indexName: "byWeight",
    propertyKey: "weight",
    type: "mixed",
    element: "Edge",
    schemaLabel: "knows",
    unique: false,
    backend: "search",
  });

  assert.match(vertexScript, /__indexBuilder\.indexOnly\(__indexOnlyLabel\)/);
  assert.doesNotMatch(vertexScript, /(?:^|\n)key\s*=/);
  assert.match(edgeScript, /getEdgeLabel\("knows"\)/);
  assert.match(edgeScript, /__indexBuilder\.indexOnly\(__indexOnlyLabel\)/);
});
