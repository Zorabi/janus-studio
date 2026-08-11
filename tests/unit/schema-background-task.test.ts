import assert from "node:assert/strict";
import test from "node:test";
import type { SchemaJob } from "@janusgraph/domain";
import {
  findBackgroundSchemaJob,
  parseBackgroundSchemaTask,
} from "../../apps/desktop/src/renderer/lib/schema-background-task.ts";

const job = {
  id: "job-1",
  connectionId: "connection-1",
  connectionName: "Production",
  indexName: "production.schema.json",
  action: "IMPORT_SCHEMA",
  query: "schema",
  status: "succeeded",
  message: "Completed 12/12 batches",
  durationMs: 100,
  createdAt: "2026-08-10T10:00:00.000Z",
  updatedAt: "2026-08-10T10:01:00.000Z",
} satisfies SchemaJob;

test("restores and matches an acknowledged background Schema task", () => {
  const task = parseBackgroundSchemaTask(JSON.stringify({
    connectionId: "connection-1",
    fileName: "production.schema.json",
    startedAt: "2026-08-10T09:59:59.000Z",
  }));
  assert.ok(task);
  assert.equal(findBackgroundSchemaJob([job], task)?.id, job.id);
  assert.equal(findBackgroundSchemaJob([{ ...job, id: "other" }], { ...task, jobId: job.id }), undefined);
});

test("rejects invalid tracking data and ignores older jobs", () => {
  assert.equal(parseBackgroundSchemaTask("{}"), null);
  assert.equal(parseBackgroundSchemaTask("not-json"), null);
  assert.equal(findBackgroundSchemaJob([job], {
    connectionId: job.connectionId,
    fileName: job.indexName,
    startedAt: "2026-08-10T10:10:00.000Z",
  }), undefined);
});
