import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { ConnectionRepository } from "../../apps/desktop/src/main/storage/connection-repository.ts";
import { openApplicationDatabase } from "../../apps/desktop/src/main/storage/database.ts";
import { HistoryRepository } from "../../apps/desktop/src/main/storage/history-repository.ts";
import { SchemaJobRepository } from "../../apps/desktop/src/main/storage/schema-job-repository.ts";
import { BackgroundTaskRepository } from "../../apps/desktop/src/main/storage/background-task-repository.ts";
import { GraphTransferRepository } from "../../apps/desktop/src/main/storage/graph-transfer-repository.ts";
import { QueryAssetRepository } from "../../apps/desktop/src/main/storage/query-asset-repository.ts";

test("persists connection profiles, advanced transport settings and history", () => {
  const directory = mkdtempSync(join(tmpdir(), "janus-studio-test-"));
  const database = openApplicationDatabase(join(directory, "app.sqlite"));
  try {
    const connections = new ConnectionRepository(database);
    const saved = connections.save("connection-1", {
      name: "QA",
      protocol: "https",
      host: "localhost",
      port: 8182,
      path: "/gremlin",
      username: "qa",
      environment: "test",
      connectionReadOnly: true,
      clientMode: "sessionless",
      traversalSource: "g",
      graphBinding: "graph",
      connectTimeoutMs: 5_000,
      queryTimeoutMs: 30_000,
      tlsRejectUnauthorized: false,
      enableCompression: true,
      customHeaders: "{\"X-QA\":\"1\"}",
    }, new Uint8Array([1, 2, 3]));
    assert.equal(saved.hasPassword, true);
    assert.equal(saved.tlsRejectUnauthorized, false);
    assert.equal(saved.enableCompression, true);
    assert.equal(saved.environment, "test");
    assert.equal(saved.connectionReadOnly, true);
    assert.equal(connections.find(saved.id)?.profile.customHeaders, "{\"X-QA\":\"1\"}");

    const history = new HistoryRepository(database);
    const entry = history.add(saved.id, saved.name, "g.V().count()", "success", 12, 1);
    assert.equal(history.list(10)[0]?.id, entry.id);
    history.remove(entry.id);
    assert.equal(history.list(10).length, 0);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("filters and paginates all query history statuses", () => {
  const directory = mkdtempSync(join(tmpdir(), "janus-studio-history-test-"));
  const database = openApplicationDatabase(join(directory, "app.sqlite"));
  try {
    const history = new HistoryRepository(database);
    const successful = history.add("connection-a", "A", "g.V()", "success", 10, 1);
    const truncated = history.add("connection-a", "A", "g.V().limit(20000)", "truncated", 20, 20_000);
    const cancelled = history.add("connection-b", "B", "g.V().repeat(out())", "cancelled", 30, 0, "查询已停止");
    const failed = history.add("connection-b", "B", "g.addV()", "error", 40, 0, "denied");
    database.prepare("UPDATE query_history SET created_at = ? WHERE id = ?").run("2026-08-01T00:00:00.000Z", successful.id);
    database.prepare("UPDATE query_history SET created_at = ? WHERE id = ?").run("2026-08-02T00:00:00.000Z", truncated.id);
    database.prepare("UPDATE query_history SET created_at = ? WHERE id = ?").run("2026-08-03T00:00:00.000Z", cancelled.id);
    database.prepare("UPDATE query_history SET created_at = ? WHERE id = ?").run("2026-08-04T00:00:00.000Z", failed.id);

    assert.deepEqual(
      history.list({ connectionId: "connection-a", statuses: ["truncated"] }).map(({ id }) => id),
      [truncated.id],
    );
    assert.deepEqual(
      history.list({ statuses: ["error", "cancelled"], createdFrom: "2026-08-03T00:00:00.000Z" }).map(({ id }) => id),
      [failed.id, cancelled.id],
    );
    assert.deepEqual(
      history.list({ limit: 2, offset: 1 }).map(({ id }) => id),
      [cancelled.id, truncated.id],
    );
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("persists completed, failed and interrupted schema operation history", () => {
  const directory = mkdtempSync(join(tmpdir(), "janusgraph-schema-job-test-"));
  const path = join(directory, "app.sqlite");
  let database = openApplicationDatabase(path);
  const jobs = new SchemaJobRepository(database);
  const running = jobs.create({
    connectionId: "connection-1",
    indexName: "byName",
    action: "REINDEX",
    query: "graph.openManagement()",
  }, "QA");
  const completed = jobs.create({
    connectionId: "connection-1",
    indexName: "byAge",
    action: "ENABLE_INDEX",
    query: "graph.openManagement()",
  }, "QA");
  jobs.finish(completed.id, "succeeded", "done", 25);
  const failed = jobs.create({
    connectionId: "connection-1",
    indexName: "byFailed",
    action: "REINDEX",
    query: "graph.openManagement()",
  }, "QA");
  jobs.finish(failed.id, "failed", "failed", 25);
  database.close();

  database = openApplicationDatabase(path);
  try {
    const recovered = new SchemaJobRepository(database);
    assert.equal(recovered.get(running.id)?.status, "interrupted");
    assert.equal(recovered.get(completed.id)?.status, "succeeded");
    assert.equal(recovered.get(failed.id)?.status, "failed");
    assert.equal(recovered.list("connection-1").length, 3);
    recovered.remove(running.id);
    assert.equal(recovered.list("connection-1").length, 2);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("persists unified background tasks, unread results and interrupted recovery", () => {
  const directory = mkdtempSync(join(tmpdir(), "janusgraph-background-task-test-"));
  const path = join(directory, "app.sqlite");
  let database = openApplicationDatabase(path);
  const tasks = new BackgroundTaskRepository(database);
  const running = tasks.publish({
    id: "00000000-0000-4000-8000-000000000001",
    kind: "transfer",
    action: "import",
    title: "graph2",
    connectionId: "connection-1",
    graphName: "graph2",
    status: "running",
    stage: "importing",
    message: "Importing",
    progressCurrent: 0,
    progressTotal: 0,
    progressUnit: "file",
    cancellable: true,
    retriable: false,
  }, "Docker");
  assert.equal(running.acknowledged, true);

  const failed = tasks.publish({
    ...running,
    kind: "transfer",
    status: "failed",
    message: "Server failed",
    cancellable: false,
    retriable: true,
  }, "Docker");
  assert.equal(failed.acknowledged, false);
  tasks.acknowledge(failed.id);
  assert.equal(tasks.get(failed.id)?.acknowledged, true);

  tasks.publish({
    ...running,
    id: "00000000-0000-4000-8000-000000000002",
    kind: "transfer",
    action: "export",
    status: "cancel_requested",
    stage: "exporting",
    message: "Cancellation requested",
    cancellable: false,
  }, "Docker");
  database.close();

  database = openApplicationDatabase(path);
  try {
    const recovered = new BackgroundTaskRepository(database);
    const interrupted = recovered.get("00000000-0000-4000-8000-000000000002");
    assert.equal(interrupted?.status, "interrupted");
    assert.equal(interrupted?.acknowledged, false);
    assert.equal(interrupted?.retriable, true);
    recovered.dismiss(interrupted!.id);
    assert.equal(recovered.get(interrupted!.id), undefined);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("persists GraphSON task inputs and batch-loading recovery outside the renderer session", () => {
  const directory = mkdtempSync(join(tmpdir(), "janusgraph-transfer-run-test-"));
  const path = join(directory, "app.sqlite");
  let database = openApplicationDatabase(path);
  const runs = new GraphTransferRepository(database);
  const input = {
    connectionId: "connection-1",
    action: "import" as const,
    graphName: "graph2",
    graphBinding: "graph2",
    graphAccess: "configured" as const,
    fileAccess: "path" as const,
    serverPath: "/data/graph2.graphson",
    enableBatchLoading: true,
    disableAutomaticSchema: true,
    productionConfirmed: true,
  };
  const recovery = {
    hasBatchLoading: true,
    batchLoading: false,
    hasSchemaDefault: true,
    schemaDefault: "tp3",
  };
  runs.save("task-1", input);
  runs.setRecovery("task-1", recovery);
  database.close();

  database = openApplicationDatabase(path);
  try {
    const restored = new GraphTransferRepository(database);
    assert.deepEqual(restored.input("task-1"), input);
    assert.deepEqual(restored.recovery("task-1"), recovery);
    restored.setRecovery("task-1", null);
    assert.equal(restored.recovery("task-1"), undefined);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("persists query asset tags, folders, snippets and immutable history metadata", () => {
  const directory = mkdtempSync(join(tmpdir(), "janusgraph-query-assets-test-"));
  const path = join(directory, "app.sqlite");
  let database = openApplicationDatabase(path);
  const history = new HistoryRepository(database);
  const historyEntry = history.add("connection-1", "Docker", "g.V().count()", "success", 12, 1);
  const assets = new QueryAssetRepository(database);
  const tag = assets.saveTag({ name: "capacity", color: "#b7ff3c" });
  const parent = assets.saveFolder({ name: "Operations", parentId: "", sortOrder: 1 });
  const child = assets.saveFolder({ name: "Production", parentId: parent.id, sortOrder: 2 });
  const snippet = assets.saveSnippet({
    name: "Count vertices",
    description: "Capacity check",
    query: "g.V().count()",
    bindingsText: "{}",
    connectionId: "",
    graphName: "graph2",
    folderId: child.id,
    starred: true,
    tagIds: [tag.id],
  });
  assets.saveHistoryMetadata({
    historyId: historyEntry.id,
    starred: true,
    note: "Known baseline",
    tagIds: [tag.id],
  });
  database.close();

  database = openApplicationDatabase(path);
  try {
    const restored = new QueryAssetRepository(database);
    assert.deepEqual(restored.listTags().map((item) => item.name), ["capacity"]);
    assert.deepEqual(restored.listFolders().map((item) => item.name), ["Operations", "Production"]);
    assert.throws(() => restored.saveFolder({ id: parent.id, name: "Operations", parentId: child.id, sortOrder: 1 }), /循环/);
    assert.deepEqual(restored.listSnippets({ tagIds: [tag.id], starred: true }).map((item) => item.id), [snippet.id]);
    const metadata = restored.historyMetadata([historyEntry.id])[0];
    assert.equal(metadata?.starred, true);
    assert.equal(metadata?.note, "Known baseline");
    assert.deepEqual(metadata?.tags.map((item) => item.id), [tag.id]);
    restored.removeTag(tag.id);
    assert.deepEqual(restored.listSnippets()[0]?.tags, []);
    assert.deepEqual(restored.historyMetadata([historyEntry.id])[0]?.tags, []);
    new HistoryRepository(database).remove(historyEntry.id);
    assert.deepEqual(restored.historyMetadata([historyEntry.id]), []);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("keeps schema operation history after its connection is removed", () => {
  const directory = mkdtempSync(join(tmpdir(), "janusgraph-schema-connection-test-"));
  const database = openApplicationDatabase(join(directory, "app.sqlite"));
  try {
    const connections = new ConnectionRepository(database);
    connections.save("connection-1", {
      name: "QA",
      protocol: "ws",
      host: "localhost",
      port: 8182,
      path: "/gremlin",
      username: "",
      environment: "dev",
      connectionReadOnly: false,
      clientMode: "sessionless",
      traversalSource: "g",
      graphBinding: "graph",
      connectTimeoutMs: 5_000,
      queryTimeoutMs: 30_000,
      tlsRejectUnauthorized: true,
      enableCompression: false,
      customHeaders: "{}",
    }, null);
    const jobs = new SchemaJobRepository(database);
    const failed = jobs.create({
      connectionId: "connection-1",
      indexName: "byName",
      action: "REINDEX",
      query: "graph.openManagement()",
    }, "QA");
    jobs.finish(failed.id, "failed", "failed", 12);

    connections.remove("connection-1");

    assert.equal(jobs.list("connection-1").length, 1);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("migrates existing connection profiles to development with write access", () => {
  const directory = mkdtempSync(join(tmpdir(), "janusgraph-connection-migration-test-"));
  const path = join(directory, "app.sqlite");
  const legacy = new DatabaseSync(path);
  legacy.exec(`
    CREATE TABLE connection_profiles (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      protocol TEXT NOT NULL,
      host TEXT NOT NULL,
      port INTEGER NOT NULL,
      path TEXT NOT NULL,
      username TEXT NOT NULL,
      client_mode TEXT NOT NULL DEFAULT 'sessionless',
      traversal_source TEXT NOT NULL,
      graph_binding TEXT NOT NULL,
      connect_timeout_ms INTEGER NOT NULL,
      query_timeout_ms INTEGER NOT NULL,
      tls_reject_unauthorized INTEGER NOT NULL DEFAULT 1,
      enable_compression INTEGER NOT NULL DEFAULT 0,
      custom_headers TEXT NOT NULL DEFAULT '{}',
      password_cipher BLOB,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    INSERT INTO connection_profiles VALUES (
      'legacy', 'Legacy', 'ws', 'localhost', 8182, '/gremlin', '',
      'sessionless', 'g', 'graph', 5000, 30000, 1, 0, '{}', NULL,
      '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'
    );
  `);
  legacy.close();

  const database = openApplicationDatabase(path);
  try {
    const migrated = new ConnectionRepository(database).find("legacy")?.profile;
    assert.equal(migrated?.environment, "dev");
    assert.equal(migrated?.connectionReadOnly, false);
    assert.equal(database.prepare("PRAGMA user_version").get()?.user_version, 9);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
