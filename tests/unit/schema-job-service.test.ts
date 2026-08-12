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
  const executedQueries: string[] = [];
  const connections = {
    profile: () => ({ name: "QA" }),
  } as unknown as ConstructorParameters<typeof SchemaJobService>[1];
  const queries = {
    execute: async (request: { query: string }) => {
      if (queryError) throw queryError;
      executedQueries.push(request.query);
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

    executedQueries.length = 0;
    const batched = await service.run({
      ...input,
      action: "IMPORT_SCHEMA",
      query: "batch-1\nbatch-2\nbatch-3",
      queries: ["batch-1", "batch-2", "batch-3"],
    });
    assert.deepEqual(executedQueries, ["batch-1", "batch-2", "batch-3"]);
    assert.equal(batched.message, "Management API · Completed 3/3 batches");

    executedQueries.length = 0;
    const retriedBatch = await service.retry(batched.id);
    assert.deepEqual(executedQueries, ["batch-1", "batch-2", "batch-3"]);
    assert.equal(retriedBatch.status, "succeeded");

    queryError = new Error("reindex failed");
    await assert.rejects(service.run(input), queryError);
    const failed = repository.list("connection-1")[0]!;
    assert.equal(failed.status, "failed");

    queryError = null;
    const retried = await service.retry(failed.id);
    assert.equal(retried.id, failed.id);
    assert.equal(retried.status, "succeeded");
    assert.equal(repository.list("connection-1").length, 3);

    queryError = new Error("reindex failed again");
    await assert.rejects(service.run(input), queryError);
    const dismissed = repository.list("connection-1")[0]!;
    service.dismiss(dismissed.id);
    assert.equal(repository.list("connection-1").length, 3);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("cancels a running Schema import and records an interrupted batch boundary", async () => {
  const directory = mkdtempSync(join(tmpdir(), "janusgraph-schema-cancel-test-"));
  const database = openApplicationDatabase(join(directory, "app.sqlite"));
  const repository = new SchemaJobRepository(database);
  let executionCount = 0;
  let rejectActive: ((error: Error) => void) | undefined;
  let signalSecond!: () => void;
  const secondStarted = new Promise<void>((resolve) => { signalSecond = resolve; });
  const connections = { profile: () => ({ name: "QA" }) } as unknown as ConstructorParameters<typeof SchemaJobService>[1];
  const queries = {
    execute: async () => {
      executionCount += 1;
      if (executionCount === 1) return { executionId: "one", durationMs: 1, items: [], truncated: false, totalCount: 0 };
      signalSecond();
      return new Promise((_resolve, reject) => { rejectActive = reject; });
    },
    cancel: async () => {
      rejectActive?.(new Error("查询已停止"));
      return true;
    },
    closeConsole: async () => undefined,
  } as unknown as ConstructorParameters<typeof SchemaJobService>[2];
  const service = new SchemaJobService(repository, connections, queries);

  try {
    const running = service.run({
      connectionId: "connection-1",
      indexName: "schema.json",
      action: "IMPORT_SCHEMA",
      query: "batch-1",
      queries: ["batch-1", "batch-2", "batch-3"],
    });
    await secondStarted;
    assert.equal(repository.list("connection-1")[0]?.message, "Management API · Running batch 2/3");
    assert.equal(await service.cancel("connection-1"), true);
    await assert.rejects(running, /stopped after 1\/3 batches/);
    assert.equal(repository.list("connection-1")[0]?.status, "interrupted");
    assert.equal(executionCount, 2);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("persists the native Schema importer name in job progress and completion", async () => {
  const directory = mkdtempSync(join(tmpdir(), "janusgraph-schema-native-test-"));
  const database = openApplicationDatabase(join(directory, "app.sqlite"));
  const repository = new SchemaJobRepository(database);
  const service = new SchemaJobService(
    repository,
    { profile: () => ({ name: "Docker" }) } as never,
    {
      execute: async () => ({ executionId: "native", durationMs: 1, items: [], truncated: false, totalCount: 0 }),
      closeConsole: async () => undefined,
    } as never,
  );
  try {
    const completed = await service.run({
      connectionId: "connection-1",
      indexName: "official.json",
      action: "IMPORT_SCHEMA",
      query: "org.janusgraph.core.schema.JsonSchemaInitStrategy.initializeSchemaFromString(graph, '{}')",
    });
    assert.equal(completed.message, "JsonSchemaInitStrategy · Operation completed");
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
