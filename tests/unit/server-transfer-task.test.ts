import assert from "node:assert/strict";
import test from "node:test";
import {
  readServerTransferTask,
  requestServerTransferTaskCancellation,
  serverTransferTaskPublication,
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
    serverCancellation: true,
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

test("records an explicit cancellation request without discarding task progress", () => {
  const storage = memoryStorage();
  writeServerTransferTask(storage, {
    id: "task-2",
    action: "import",
    status: "running",
    stage: "importing",
    connectionId: "connection-1",
    graphName: "graph2",
    graphAccess: "configured",
    message: "running",
    totalVertices: 100,
    deletedVertices: 20,
    batches: 2,
    cancelRequested: false,
    updatedAt: "2026-08-11T00:00:00.000Z",
  });

  const requested = requestServerTransferTaskCancellation(storage, "task-2");
  assert.equal(requested?.cancelRequested, true);
  assert.equal(requested?.deletedVertices, 20);
  assert.equal(requestServerTransferTaskCancellation(storage, "other-task"), null);
});

test("maps renderer transfer state to the persistent task contract", () => {
  const publication = serverTransferTaskPublication({
    id: "task-3",
    action: "purge",
    status: "running",
    stage: "purging",
    connectionId: "connection-1",
    graphName: "graph3",
    graphAccess: "configured",
    message: "purging",
    totalVertices: 250,
    deletedVertices: 100,
    batches: 1,
    cancelRequested: true,
    updatedAt: "2026-08-11T00:00:00.000Z",
  });
  assert.equal(publication.status, "cancel_requested");
  assert.equal(publication.progressCurrent, 100);
  assert.equal(publication.progressTotal, 250);
  assert.equal(publication.cancellable, false);
});
