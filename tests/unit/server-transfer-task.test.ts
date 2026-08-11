import assert from "node:assert/strict";
import test from "node:test";
import {
  readServerTransferTask,
  writeServerTransferTask,
  type ServerTransferTask,
} from "../../apps/desktop/src/renderer/lib/server-transfer-task.ts";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  };
}

test("persists migration progress for the lifetime of a renderer session", () => {
  const storage = memoryStorage();
  const task: ServerTransferTask = {
    id: "task-1",
    action: "purge",
    status: "running",
    stage: "purging",
    connectionId: "connection-1",
    graphName: "graph1",
    graphAccess: "configured",
    message: "running",
    totalVertices: 1_250,
    deletedVertices: 300,
    batches: 3,
    cancelRequested: false,
    updatedAt: "2026-08-11T00:00:00.000Z",
  };

  writeServerTransferTask(storage, task);
  assert.deepEqual(readServerTransferTask(storage), task);
  writeServerTransferTask(storage, null);
  assert.equal(readServerTransferTask(storage), null);
});

test("rejects damaged session task state", () => {
  const storage = memoryStorage();
  storage.setItem("janus-studio.transfer.server-task", "not-json");
  assert.equal(readServerTransferTask(storage), null);
});
