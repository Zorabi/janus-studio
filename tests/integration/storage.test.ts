import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ConnectionRepository } from "../../apps/desktop/src/main/storage/connection-repository.ts";
import { openApplicationDatabase } from "../../apps/desktop/src/main/storage/database.ts";
import { HistoryRepository } from "../../apps/desktop/src/main/storage/history-repository.ts";
import { SchemaJobRepository } from "../../apps/desktop/src/main/storage/schema-job-repository.ts";

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
