import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { SchemaJobService } from "../../apps/desktop/src/main/services/schema-job-service.ts";
import { openApplicationDatabase } from "../../apps/desktop/src/main/storage/database.ts";
import { SchemaJobRepository } from "../../apps/desktop/src/main/storage/schema-job-repository.ts";

test("persists schema job history and supports retrying or deleting records", async () => {
  const directory = mkdtempSync(join(tmpdir(), "janusgraph-schema-service-test-"));
  const database = openApplicationDatabase(join(directory, "app.sqlite"));
  const repository = new SchemaJobRepository(database);
  let queryError: Error | null = null;
  const connections = {
    profile: () => ({ name: "QA" }),
  } as unknown as ConstructorParameters<typeof SchemaJobService>[1];
  const queries = {
    execute: async () => {
      if (queryError) throw queryError;
      return {
        executionId: "execution",
        durationMs: 1,
        items: [],
        truncated: false,
        totalCount: 0,
      };
    },
    closeConsole: async () => undefined,
  } as unknown as ConstructorParameters<typeof SchemaJobService>[2];
  const service = new SchemaJobService(repository, connections, queries);
  const input = {
    connectionId: "connection-1",
    indexName: "byName",
    action: "REINDEX",
    query: "graph.openManagement()",
  };

  try {
    const completed = await service.run(input);
    assert.equal(completed.status, "succeeded");
    assert.equal(repository.list("connection-1").length, 1);

    queryError = new Error("reindex failed");
    await assert.rejects(service.run(input), queryError);
    const failed = repository.list("connection-1")[0]!;
    assert.equal(failed.status, "failed");

    queryError = null;
    const retried = await service.retry(failed.id);
    assert.equal(retried.id, failed.id);
    assert.equal(retried.status, "succeeded");
    assert.equal(repository.list("connection-1").length, 2);

    queryError = new Error("reindex failed again");
    await assert.rejects(service.run(input), queryError);
    const dismissed = repository.list("connection-1")[0]!;
    service.dismiss(dismissed.id);
    assert.equal(repository.list("connection-1").length, 2);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
