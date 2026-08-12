import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  createOfficialSchemaDefinition,
  createSchemaArchive,
  formatSchemaArchiveTime,
  parseSchemaArchive,
  planSchemaImport,
} from "../../apps/desktop/src/renderer/lib/schema-files.ts";

const rows = [
  { group: "propertyKeys", name: "name", dataType: "String", cardinality: "SINGLE" },
  { group: "vertexLabels", name: "person", partitioned: false, static: false },
  { group: "edgeLabels", name: "knows", multiplicity: "MULTI" },
  {
    group: "graphIndexes",
    name: "byName",
    element: "Vertex",
    type: "COMPOSITE",
    unique: false,
    backingIndex: "internalindex",
    fields: ["name"],
    status: "ENABLED",
    fieldStatus: { name: "ENABLED" },
  },
];

test("exports a declarative Schema v1 archive without runtime index state", () => {
  const archive = createSchemaArchive(rows, {
    connectionName: "Local",
    graphBinding: "graph",
    traversalSource: "g",
  }, "2026-08-10T00:00:00.000Z");

  assert.equal(archive.format, "janus-studio.schema/v1");
  assert.match(archive.exportedAt, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  assert.equal(archive.exportedAt.includes("T"), false);
  assert.equal(archive.preferredImporter, "org.janusgraph.core.schema.JsonSchemaInitStrategy");
  assert.deepEqual(archive.officialSchema?.propertyKeys, [{
    key: "name",
    className: "java.lang.String",
    cardinality: "SINGLE",
  }]);
  assert.deepEqual(archive.schema.graphIndexes[0], {
    name: "byName",
    element: "Vertex",
    type: "COMPOSITE",
    unique: false,
    fields: ["name"],
  });
  assert.equal(JSON.stringify(archive).includes("fieldStatus"), false);
  assert.equal(JSON.stringify(archive).includes("ENABLED"), false);
});

test("exports a pure JanusGraph JsonSchemaDefinition document", () => {
  const definition = createOfficialSchemaDefinition(rows.map((row) =>
    row.group === "graphIndexes" ? { ...row, indexOnly: "person" } : row,
  ));

  assert.deepEqual(Object.keys(definition), [
    "vertexLabels",
    "edgeLabels",
    "propertyKeys",
    "compositeIndexes",
    "mixedIndexes",
    "vertexCentricEdgeIndexes",
    "vertexCentricPropertyIndexes",
  ]);
  assert.equal("format" in definition, false);
  assert.equal("exportedAt" in definition, false);
  assert.equal("source" in definition, false);
  assert.deepEqual(definition.propertyKeys, [{
    key: "name",
    className: "java.lang.String",
    cardinality: "SINGLE",
  }]);
  assert.deepEqual(definition.compositeIndexes, [{
    name: "byName",
    typeClass: "org.apache.tinkerpop.gremlin.structure.Vertex",
    indexOnly: "person",
    unique: false,
    keys: [{ propertyKey: "name" }],
  }]);

  const archive = parseSchemaArchive({
    name: "graph.janusgraph-schema.json",
    content: JSON.stringify(definition),
  });
  const plan = planSchemaImport(archive, [], "graph", "g", "available");
  assert.equal(archive.format, "janusgraph.schema/json");
  assert.equal(plan.execution, "official-json");
  assert.match(plan.script ?? "", /JsonSchemaInitStrategy\.initializeSchemaFromString/);
});

test("parses and validates Schema archives", () => {
  const source = createSchemaArchive(rows, {
    connectionName: "Local",
    graphBinding: "graph",
    traversalSource: "g",
  });
  const parsed = parseSchemaArchive({ name: "schema.json", content: JSON.stringify(source) });
  assert.equal(parsed.schema.propertyKeys[0]?.name, "name");

  assert.throws(
    () => parseSchemaArchive({ name: "bad.json", content: "{}" }),
    /Schema v1/,
  );
  assert.throws(
    () => parseSchemaArchive({
      name: "bad-type.json",
      content: JSON.stringify({
        ...source,
        schema: {
          ...source.schema,
          propertyKeys: [{ name: "payload", dataType: "Runtime", cardinality: "SINGLE" }],
        },
      }),
    }),
    /不受支持/,
  );
});

test("plans additive imports in dependency order and skips matching definitions", () => {
  const archive = createSchemaArchive(rows, {
    connectionName: "Source",
    graphBinding: "sourceGraph",
    traversalSource: "sourceG",
  });
  const plan = planSchemaImport(archive, [rows[0]], "targetGraph", "targetG");

  assert.equal(plan.skipped.length, 1);
  assert.deepEqual(plan.operations.map((item) => item.name), ["person", "knows", "byName"]);
  assert.equal(plan.conflicts.length, 0);
  assert.match(plan.script ?? "", /hasVariable\("targetGraph"\)/);
  assert.match(plan.script ?? "", /hasVariable\("targetG"\)/);
  assert.match(plan.script ?? "", /__graph\.openManagement\(\)/);
  assert.match(plan.script ?? "", /makeVertexLabel\("person"\)/);
  assert.match(plan.script ?? "", /buildCompositeIndex\(\)/);
  assert.match(plan.script ?? "", /Schema definition conflict/);
  assert.match(plan.script ?? "", /Schema import verification failed/);
  assert.match(plan.script ?? "", /getVertexLabel\("person"\)/);
  assert.match(plan.script ?? "", /getGraphIndex\("byName"\)/);
  assert.deepEqual(plan.indexActivations, ["byName"]);
  assert.equal(plan.scripts.length, 7);
  assert.match(plan.scripts[3] ?? "", /REGISTER_INDEX/);
  assert.match(plan.scripts[3] ?? "", /__index\.getIndexStatus\(__key\)/);
  assert.doesNotMatch(plan.scripts[3] ?? "", /mgmt\.getIndexStatus/);
  assert.match(plan.scripts[4] ?? "", /awaitGraphIndexStatus/);
  assert.match(plan.scripts[4] ?? "", /REGISTERED/);
  assert.match(plan.scripts[4] ?? "", /indexes: __names/);
  assert.doesNotMatch(plan.scripts[4] ?? "", /getConvergedKeys/);
  assert.match(plan.scripts[5] ?? "", /REINDEX/);
  assert.match(plan.scripts[6] ?? "", /awaitGraphIndexStatus/);
  assert.match(plan.scripts[6] ?? "", /ENABLED/);
  assert.ok(plan.scripts.every((script) => script.length < 60_000));
  assert.ok((plan.script ?? "").indexOf("makeVertexLabel") < (plan.script ?? "").indexOf("buildIndex"));
});

test("generates retry-safe idempotent import batches", () => {
  const archive = createSchemaArchive(rows, {
    connectionName: "Source",
    graphBinding: "graph",
    traversalSource: "g",
  });
  const plan = planSchemaImport(archive, [], "graph");
  const definitionScript = plan.scripts.slice(0, 4).join("\n");

  assert.match(definitionScript, /if \(existingPropertyKey\d+ == null\)/);
  assert.match(definitionScript, /if \(existingVertexLabel\d+ == null\)/);
  assert.match(definitionScript, /if \(existingEdgeLabel\d+ == null\)/);
  assert.match(definitionScript, /if \(existingGraphIndex\d+ == null\)/);
  assert.match(definitionScript, /Schema definition conflict/);
});

test("formats archive timestamps as local readable time without ISO separators", () => {
  assert.match(formatSchemaArchiveTime("2026-08-10T02:14:01.119Z"), /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  assert.equal(formatSchemaArchiveTime("not-a-date"), "not-a-date");
});

test("plans lifecycle batches for matching registered indexes", () => {
  const archive = createSchemaArchive(rows, {
    connectionName: "Source",
    graphBinding: "graph",
    traversalSource: "g",
  });
  const current = rows.map((row) => row.group === "graphIndexes"
    ? { ...row, status: "REGISTERED", fieldStatus: { name: "REGISTERED" } }
    : row);
  const plan = planSchemaImport(archive, current, "graph");

  assert.equal(plan.operations.length, 0);
  assert.deepEqual(plan.indexActivations, ["byName"]);
  assert.equal(plan.scripts.length, 4);
  assert.match(plan.scripts[1] ?? "", /REGISTERED/);
  assert.match(plan.scripts[3] ?? "", /ENABLED/);
  assert.match(plan.scripts[3] ?? "", /verified: true/);
});

test("blocks incompatible definitions and missing index dependencies", () => {
  const archive = createSchemaArchive(rows, {
    connectionName: "Source",
    graphBinding: "graph",
    traversalSource: "g",
  });
  const incompatible = planSchemaImport(archive, [
    { group: "propertyKeys", name: "name", dataType: "Long", cardinality: "SINGLE" },
  ], "graph");
  assert.equal(incompatible.script, null);
  assert.ok(incompatible.conflicts.some((item) => item.key === "propertyKeys:name"));

  const missingDependency = parseSchemaArchive({
    name: "missing.json",
    content: JSON.stringify({
      format: "janus-studio.schema/v1",
      exportedAt: "2026-08-10T00:00:00.000Z",
      source: { connectionName: "Source", graphBinding: "graph", traversalSource: "g" },
      schema: {
        propertyKeys: [],
        vertexLabels: [],
        edgeLabels: [],
        graphIndexes: [{
          name: "byMissing",
          element: "Vertex",
          type: "COMPOSITE",
          unique: false,
          fields: ["missing"],
        }],
      },
    }),
  });
  const dependencyPlan = planSchemaImport(missingDependency, [], "graph");
  assert.equal(dependencyPlan.script, null);
  assert.deepEqual(dependencyPlan.scripts, []);
  assert.match(dependencyPlan.conflicts[0]?.reason ?? "", /missing/);
});

test("splits large Schema imports into bounded dependency-ordered batches", () => {
  const archive = createSchemaArchive([
    ...Array.from({ length: 61 }, (_, index) => ({
      group: "propertyKeys",
      name: `property${index}`,
      dataType: "String",
      cardinality: "SINGLE",
    })),
    { group: "vertexLabels", name: "person", partitioned: false, static: false },
  ], {
    connectionName: "Source",
    graphBinding: "graph",
    traversalSource: "g",
  });
  const plan = planSchemaImport(archive, [], "targetGraph", "targetG");

  assert.equal(plan.scripts.length, 4);
  assert.ok(plan.scripts.slice(0, 3).every((script) => script.includes("makePropertyKey")));
  assert.match(plan.scripts[3] ?? "", /makeVertexLabel/);
  assert.ok(plan.scripts.every((script) => script.length < 60_000));
});

test("parses JanusGraph 1.1 official JSON without dropping native-only fields", () => {
  const content = readFileSync(
    new URL("../fixtures/schema/janusgraph-1.1-official.json", import.meta.url),
    "utf8",
  );
  const archive = parseSchemaArchive({ name: "official.json", content });

  assert.equal(archive.format, "janusgraph.schema/json");
  assert.deepEqual(archive.schema.propertyKeys.map((item) => item.name), ["name", "createdAt"]);
  assert.deepEqual(archive.schema.graphIndexes.map((item) => item.name), ["byName", "searchByName"]);
  assert.ok(archive.manual?.some((item) => item.path === "vertexLabels[1].ttl"));
  assert.ok(archive.manual?.some((item) => item.path === "edgeLabels[0].unidirected"));
  assert.ok(archive.manual?.some((item) => item.path === "mixedIndexes[0].keys[0].parameters"));
  assert.ok(archive.manual?.some((item) => item.path === "vertexCentricEdgeIndexes[0]"));
  assert.equal((archive.officialSchema?.vertexCentricEdgeIndexes as unknown[]).length, 1);
});

test("routes official JSON through bounded JanusGraph 1.1 native batches", () => {
  const content = readFileSync(
    new URL("../fixtures/schema/janusgraph-1.1-official.json", import.meta.url),
    "utf8",
  );
  const archive = parseSchemaArchive({ name: "official.json", content });
  const plan = planSchemaImport(archive, [], "graph", "g", "available");

  assert.equal(plan.execution, "official-json");
  assert.equal(plan.conflicts.length, 0);
  assert.ok(plan.manual.length >= 4);
  assert.equal(plan.scripts.length, 6);
  assert.ok(plan.scripts.every((script) => script.includes("JsonSchemaInitStrategy.initializeSchemaFromString")));
  assert.ok(plan.scripts.every((script) => script.includes("REINDEX_AND_ENABLE_UPDATED_ONLY")));
  assert.ok(plan.scripts.every((script) => script.includes("false,")));
  assert.ok(plan.scripts.every((script) => script.length < 60_000));
  assert.match(plan.script ?? "", /vertexCentricEdgeIndexes/);
});

test("round-trips Studio exports through JsonSchemaInitStrategy when the server supports it", () => {
  const source = createSchemaArchive(rows, {
    connectionName: "Source",
    graphBinding: "graph",
    traversalSource: "g",
  }, "2026-08-10T00:00:00.000Z");
  const archive = parseSchemaArchive({ name: "studio.schema.json", content: JSON.stringify(source) });
  const plan = planSchemaImport(archive, [], "graph", "g", "available");

  assert.equal(archive.exportedAt, source.exportedAt);
  assert.equal(plan.execution, "official-json");
  assert.match(plan.script ?? "", /JsonSchemaInitStrategy\.initializeSchemaFromString/);
});

test("blocks lossy official JSON fallback but converts the common subset on JanusGraph 1.0", () => {
  const advanced = parseSchemaArchive({
    name: "advanced.json",
    content: readFileSync(new URL("../fixtures/schema/janusgraph-1.1-official.json", import.meta.url), "utf8"),
  });
  const blocked = planSchemaImport(advanced, [], "graph", "g", "unavailable");
  assert.equal(blocked.execution, "management");
  assert.match(blocked.conflicts.find((item) => item.key === "officialSchemaJson")?.reason ?? "", /无法无损降级/);
  assert.equal(blocked.scripts.length, 0);

  const portable = parseSchemaArchive({
    name: "portable.json",
    content: JSON.stringify({
      propertyKeys: [{ key: "name", className: "java.lang.String", cardinality: "SINGLE" }],
      vertexLabels: [{ label: "person" }],
      edgeLabels: [],
      compositeIndexes: [],
      mixedIndexes: [],
      vertexCentricEdgeIndexes: [],
      vertexCentricPropertyIndexes: [],
    }),
  });
  const fallback = planSchemaImport(portable, [], "graph", "g", "unavailable");
  assert.equal(fallback.execution, "management");
  assert.equal(fallback.conflicts.length, 0);
  assert.match(fallback.script ?? "", /makePropertyKey/);
  assert.doesNotMatch(fallback.script ?? "", /JsonSchemaInitStrategy/);
});
