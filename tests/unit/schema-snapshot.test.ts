import assert from "node:assert/strict";
import test from "node:test";
import {
  compareSchemaRows,
  parseSchemaSnapshotBaseline,
  schemaSnapshotRows,
} from "../../apps/desktop/src/renderer/lib/schema-snapshot.ts";

test("migrates legacy snapshot arrays and reads timestamped baselines", () => {
  const row = { group: "propertyKeys", name: "name", dataType: "String" };
  assert.deepEqual(parseSchemaSnapshotBaseline(JSON.stringify([row])), { savedAt: "", rows: [row] });
  assert.deepEqual(parseSchemaSnapshotBaseline(JSON.stringify({ savedAt: "2026-08-12T10:00:00.000Z", rows: [row] })), {
    savedAt: "2026-08-12T10:00:00.000Z",
    rows: [row],
  });
  assert.equal(parseSchemaSnapshotBaseline("not-json"), null);
});

test("classifies baseline definitions missing from the current Schema without implying deletion", () => {
  const previous = [
    { group: "propertyKeys", name: "name", dataType: "String" },
    { group: "vertexLabels", name: "legacy" },
  ];
  const current = [
    { group: "propertyKeys", name: "name", dataType: "Long" },
    { group: "vertexLabels", name: "person" },
  ];
  assert.deepEqual(compareSchemaRows(previous, current), {
    added: ["vertexLabels:person"],
    missing: ["vertexLabels:legacy"],
    changed: ["propertyKeys:name"],
  });
});

test("normalizes snapshot rows into stable group and name order", () => {
  assert.deepEqual(schemaSnapshotRows([
    { group: "vertexLabels", name: "person", partitioned: false, static: false },
    { group: "propertyKeys", name: "age", dataType: "Long", cardinality: "SINGLE" },
  ]).map((row) => `${row.group}:${row.name}`), ["propertyKeys:age", "vertexLabels:person"]);
});
