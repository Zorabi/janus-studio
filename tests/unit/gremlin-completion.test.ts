import assert from "node:assert/strict";
import test from "node:test";
import {
  schemaCatalogFromRows,
  schemaCompletions,
} from "../../apps/desktop/src/renderer/lib/gremlin-completion.ts";

const catalog = {
  vertexLabels: ["person", "company"],
  edgeLabels: ["knows", "works_at"],
  propertyKeys: ["name", "createdAt"],
};

test("builds a sorted schema catalog from Management API rows", () => {
  assert.deepEqual(schemaCatalogFromRows([
    [
      { group: "propertyKeys", name: "name" },
      { group: "vertexLabels", name: "person" },
      { group: "vertexLabels", name: "v10" },
      { group: "vertexLabels", name: "v2" },
      { group: "vertexLabels", name: "v1" },
    ],
    { group: "edgeLabels", name: "knows" },
    { group: "vertexLabels", name: "person" },
  ]), {
    vertexLabels: ["person", "v1", "v2", "v10"],
    edgeLabels: ["knows"],
    propertyKeys: ["name"],
  });
});

test("suggests schema labels for traversal steps", () => {
  assert.deepEqual(
    schemaCompletions("g.addV(", catalog).map((item) => item.label),
    ["person", "company"],
  );
  assert.deepEqual(
    schemaCompletions("g.V().out('", catalog).map((item) => item.insertText),
    ["knows", "works_at"],
  );
});

test("suggests property keys without creating duplicate quotes", () => {
  assert.deepEqual(
    schemaCompletions("g.V().has(", catalog).map((item) => item.insertText),
    ["'name'", "'createdAt'"],
  );
  assert.deepEqual(
    schemaCompletions("g.V().values(\"", catalog).map((item) => item.insertText),
    ["name", "createdAt"],
  );
});
