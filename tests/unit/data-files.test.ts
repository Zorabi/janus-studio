import assert from "node:assert/strict";
import test from "node:test";
import {
  parseCsv,
  parseGraphArchive,
  rowsToCsv,
} from "../../apps/desktop/src/renderer/lib/data-files.ts";

test("round-trips quoted CSV fields", () => {
  const csv = rowsToCsv([
    { name: "Alice, A.", note: "line 1\nline 2", quote: "say \"hi\"" },
  ]);
  const [row] = parseCsv(csv.replace(/^\uFEFF/, ""));
  assert.deepEqual(row, {
    name: "Alice, A.",
    note: "line 1\nline 2",
    quote: "say \"hi\"",
  });
});

test("validates Janus Studio graph archives", () => {
  const archive = parseGraphArchive({
    name: "graph.json",
    extension: "json",
    content: JSON.stringify({
      format: "janus-studio.graph/v1",
      exportedAt: "2026-08-03T00:00:00.000Z",
      vertices: [{ id: 1, label: "person", properties: { name: "Alice" } }],
      edges: [{ id: "e1", label: "knows", from: 1, to: 2, properties: {} }],
    }),
  });
  assert.equal(archive.vertices[0]?.id, "1");
  assert.equal(archive.edges[0]?.to, "2");
  assert.throws(
    () => parseGraphArchive({ name: "bad.json", extension: "json", content: "{}" }),
    /Janus Studio v1/,
  );
  assert.throws(
    () => parseGraphArchive({
      name: "legacy.json",
      extension: "json",
      content: JSON.stringify({
        format: "janusgraph-observatory.graph/v1",
        vertices: [],
        edges: [],
      }),
    }),
    /Janus Studio v1/,
  );
});
