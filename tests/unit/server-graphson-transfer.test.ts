import assert from "node:assert/strict";
import test from "node:test";
import {
  graphsonExportFileName,
  parseConfiguredGraphTargets,
  parseBatchLoadingSnapshot,
  parseDeletedVertexBatch,
  parseVertexCount,
  SERVER_GRAPHSON_QUERIES,
} from "../../apps/desktop/src/renderer/lib/server-graphson-transfer.ts";

test("uses a readable local date in GraphSON export filenames", () => {
  assert.equal(graphsonExportFileName("graph2", new Date(2026, 7, 11, 23, 59, 59)), "graph2-20260811.graphson");
});

test("uses server-side TinkerPop GraphSON IO with validated absolute paths", () => {
  assert.match(SERVER_GRAPHSON_QUERIES.exportGraph, /Paths\.get\(serverPath\)/);
  assert.match(SERVER_GRAPHSON_QUERIES.exportGraph, /writeGraph/);
  assert.match(SERVER_GRAPHSON_QUERIES.exportGraph, /graphAccess == "configured"/);
  assert.match(SERVER_GRAPHSON_QUERIES.exportGraph, /getGraph\(graphBinding\)/);
  assert.match(SERVER_GRAPHSON_QUERIES.exportGraph, /janus-studio-partial/);
  assert.match(SERVER_GRAPHSON_QUERIES.exportGraph, /ATOMIC_MOVE/);
  assert.match(SERVER_GRAPHSON_QUERIES.importGraph, /readGraph/);
  assert.match(SERVER_GRAPHSON_QUERIES.importGraph, /isReadable/);
});

test("captures and restores the complete batch-loading configuration state", () => {
  assert.match(SERVER_GRAPHSON_QUERIES.enableBatchLoading, /storage\.batch-loading/);
  assert.match(SERVER_GRAPHSON_QUERIES.enableBatchLoading, /schema\.default/);
  assert.match(SERVER_GRAPHSON_QUERIES.restoreBatchLoading, /removeConfiguration/);
  assert.match(SERVER_GRAPHSON_QUERIES.restoreBatchLoading, /updateConfiguration/);
  assert.deepEqual(parseBatchLoadingSnapshot([{
    hasBatchLoading: true,
    batchLoading: false,
    hasSchemaDefault: true,
    schemaDefault: "none",
  }]), {
    hasBatchLoading: true,
    batchLoading: false,
    hasSchemaDefault: true,
    schemaDefault: "none",
  });
});

test("parses dynamic graph targets returned by ConfiguredGraphFactory", () => {
  assert.match(SERVER_GRAPHSON_QUERIES.listConfiguredGraphs, /getGraphNames/);
  assert.deepEqual(parseConfiguredGraphTargets([[
    { name: "graph1", traversalSource: "graph1_traversal" },
    { name: "graph2", traversalSource: "graph2_traversal" },
  ]]), [
    { name: "graph1", traversalSource: "graph1_traversal" },
    { name: "graph2", traversalSource: "graph2_traversal" },
  ]);
});

test("deletes vertices in bounded committed batches while preserving schema", () => {
  assert.match(SERVER_GRAPHSON_QUERIES.deleteVertexBatch, /Math\.min\(\(\(Number\) batchSize\)\.intValue\(\), 100\)/);
  assert.match(SERVER_GRAPHSON_QUERIES.deleteVertexBatch, /hasId/);
  assert.match(SERVER_GRAPHSON_QUERIES.deleteVertexBatch, /tx\(\)\.commit/);
  assert.match(SERVER_GRAPHSON_QUERIES.deleteVertexBatch, /tx\(\)\.rollback/);
  assert.deepEqual(parseDeletedVertexBatch([{ deleted: 100, complete: false }]), {
    deleted: 100,
    complete: false,
  });
  assert.deepEqual(parseDeletedVertexBatch([{ deleted: 0, complete: false }]), {
    deleted: 0,
    complete: true,
  });
  assert.match(SERVER_GRAPHSON_QUERIES.countVertices, /V\(\)\.count\(\)\.next\(\)/);
  assert.deepEqual(parseVertexCount([{ total: 12_345 }]), { total: 12_345 });
});
