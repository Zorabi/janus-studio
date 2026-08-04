import assert from "node:assert/strict";
import test from "node:test";
import {
  buildGraphModel,
  buildTableRows,
  decodeGraphValue,
  gremlinConsoleOutput,
  mergeGraphModels,
  orderedInspectorEntries,
  structuredJsonItems,
  tableColumns,
} from "../../apps/desktop/src/renderer/lib/result-model.ts";

test("decodes GraphSON typed maps without losing nested values", () => {
  const decoded = decodeGraphValue({
    "@type": "g:Map",
    "@value": ["name", "alice", "score", { "@type": "g:Int64", "@value": 42 }],
  });
  assert.deepEqual(decoded, { name: "alice", score: 42 });
});

test("builds a connected topology and preserves endpoint metadata", () => {
  const model = buildGraphModel([
    { id: 1, label: "person", properties: { name: "Alice" } },
    {
      id: "e-1",
      label: "works_at",
      outV: { id: 1, label: "person" },
      inV: { id: 2, label: "company" },
      properties: { since: 2024 },
    },
  ]);
  assert.equal(model.nodes.length, 2);
  assert.equal(model.edges.length, 1);
  assert.equal(model.nodes.find((node) => node.id === "2")?.label, "company");
  assert.deepEqual(model.edges[0]?.properties, { since: 2024 });
});

test("merges enrichment and flattens table rows deterministically", () => {
  const merged = mergeGraphModels(
    { nodes: [{ id: "1", label: "person", properties: { name: "Alice" } }], edges: [] },
    { nodes: [{ id: "1", label: "person", properties: { city: "Shanghai" } }], edges: [] },
  );
  assert.deepEqual(merged.nodes[0]?.properties, { name: "Alice", city: "Shanghai" });

  const rows = buildTableRows([{ id: 1, properties: { name: "Alice", score: 91 } }]);
  assert.deepEqual(rows[0], {
    "#": 1,
    id: 1,
    name: "Alice",
    score: 91,
  });
  assert.deepEqual(tableColumns(rows), ["#", "id", "name", "score"]);
});

test("sorts result columns by pinned metadata and natural alpha-numeric order", () => {
  assert.deepEqual(tableColumns([{
    cp12: "twelve",
    p4: "four",
    cp2: "two",
    label: "device",
    cp0: "zero",
    id: 7,
    cp1: "one",
    "#": 1,
  }]), ["#", "id", "label", "cp0", "cp1", "cp2", "cp12", "p4"]);
});

test("sorts inspector identity first and properties naturally on first render", () => {
  assert.deepEqual(
    orderedInspectorEntries({
      cp12: "twelve",
      LABEL: "device",
      cp2: "two",
      ID: 7,
      cp0: "zero",
    }),
    [
      ["ID", 7],
      ["LABEL", "device"],
      ["cp0", "zero"],
      ["cp2", "two"],
      ["cp12", "twelve"],
    ],
  );
});

test("presents vertex property values without exposing transport metadata", () => {
  const rows = buildTableRows([{
    id: 7,
    label: "person",
    properties: {
      name: [{ id: "vp-1", label: "name", value: "Alice", key: "name" }],
      tag: [
        { id: "vp-2", label: "tag", value: "engineer" },
        { id: "vp-3", label: "tag", value: "mentor" },
      ],
    },
  }]);
  assert.deepEqual(rows[0], {
    "#": 1,
    id: 7,
    label: "person",
    name: "Alice",
    tag: ["engineer", "mentor"],
  });
});

test("renders Gremlin Console compatible result lines", () => {
  assert.equal(gremlinConsoleOutput([
    { cp0: "v11", cp2: "SSH_10.27.22.23", id: 1, label: "v11" },
    ["alpha", 2],
  ]), "==>{cp0=v11, cp2=SSH_10.27.22.23, id=1, label=v11}\n==>[alpha, 2]");
});

test("preserves multiline console reports from profile, explain and printSchema", () => {
  assert.equal(
    gremlinConsoleOutput(["Traversal Metrics\nStep     Count\nTOTAL    1"]),
    "==>Traversal Metrics\nStep     Count\nTOTAL    1",
  );
});

test("renders vertex properties as Gremlin Console values instead of transport JSON", () => {
  assert.equal(gremlinConsoleOutput([{
    id: 7,
    label: "person",
    properties: {
      cp12: [{ id: "vp-2", label: "cp12", value: "Shanghai" }],
      cp2: [{ id: "vp-1", label: "cp2", value: "Alice" }],
    },
  }]), "==>{cp2=Alice, cp12=Shanghai, id=7, label=person}");
});

test("builds simplified and naturally sorted JSON without vertex property metadata", () => {
  assert.deepEqual(structuredJsonItems([{
    label: "person",
    id: 7,
    properties: {
      cp12: [{ id: "vp-12", label: "cp12", value: "twelve" }],
      cp2: [{ id: "vp-2", label: "cp2", value: "two" }],
    },
  }]), [{ id: 7, label: "person", cp2: "two", cp12: "twelve" }]);
});
