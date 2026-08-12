import assert from "node:assert/strict";
import test from "node:test";
import { GraphTransferService } from "../../apps/desktop/src/main/services/graph-transfer-service.ts";

function task(id: string, status: "running" | "failed" = "running") {
  return {
    id,
    kind: "transfer" as const,
    action: "purge",
    title: "graph2",
    connectionId: "connection-1",
    connectionName: "Docker",
    graphName: "graph2",
    status,
    stage: "purging",
    message: "running",
    progressCurrent: 100,
    progressTotal: 500,
    progressUnit: "vertex",
    cancellable: status === "running",
    retriable: status === "failed",
    acknowledged: status === "running",
    createdAt: "2026-08-12T00:00:00.000Z",
    updatedAt: "2026-08-12T00:00:00.000Z",
    completedAt: "",
  };
}

test("requests main-process cancellation without losing persisted purge progress", async () => {
  let stored = task("task-1");
  const repository = {
    get: () => stored,
    requestCancellation: (_id: string, message: string) => {
      stored = { ...stored, status: "cancel_requested" as never, cancellable: false, message };
      return stored;
    },
  };
  const service = new GraphTransferService(
    repository as never,
    {} as never,
    {} as never,
    { cancel: async () => true } as never,
    {} as never,
    {} as never,
  );

  assert.equal(await service.cancel("task-1"), true);
  assert.equal(stored.progressCurrent, 100);
  assert.equal(stored.progressTotal, 500);
  assert.equal(stored.cancellable, false);
  assert.equal(stored.status, "cancel_requested");
});

test("blocks retry when the persisted execution payload is unavailable", () => {
  const service = new GraphTransferService(
    { get: () => task("task-2", "failed") } as never,
    { input: () => undefined } as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  assert.throws(() => service.retry("task-2"), /缺少可恢复执行信息/);
});

test("creates a new persisted attempt when a failed transfer is explicitly retried", async () => {
  const previous = task("task-3", "failed");
  const stored = new Map([[previous.id, previous]]);
  const repository = {
    get: (id: string) => stored.get(id),
    list: () => [...stored.values()],
    publish: (input: ReturnType<typeof task>) => {
      const next = {
        ...previous,
        ...input,
        connectionName: "Docker",
        acknowledged: input.status === "running",
      };
      stored.set(input.id, next);
      return next;
    },
  };
  const input = {
    connectionId: "connection-1",
    action: "purge" as const,
    graphName: "graph2",
    graphBinding: "graph2",
    graphAccess: "configured" as const,
    fileAccess: "path" as const,
    productionConfirmed: true,
  };
  const runs = {
    input: () => input,
    recovery: () => undefined,
    save: () => undefined,
  };
  const service = new GraphTransferService(
    repository as never,
    runs as never,
    { profile: () => ({ name: "Docker", protocol: "ws", environment: "dev", connectionReadOnly: false }) } as never,
    {} as never,
    {} as never,
    { get: async () => { throw new Error("probe unavailable"); } } as never,
  );

  const retried = service.retry(previous.id);
  assert.notEqual(retried.id, previous.id);
  assert.equal(retried.status, "running");
  assert.equal(stored.get(previous.id), previous);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(stored.get(retried.id)?.status, "failed");
});
