import type { PublishBackgroundTaskInput } from "@janusgraph/domain";

export type ServerTransferStage =
  | "docker-upload"
  | "configuring"
  | "importing"
  | "purging"
  | "exporting"
  | "docker-download"
  | "restoring";

export type ServerTransferTask = {
  id: string;
  action: "import" | "export" | "purge";
  status: "running" | "succeeded" | "failed" | "stopped";
  stage: ServerTransferStage;
  connectionId: string;
  graphName: string;
  graphAccess: "configured" | "binding";
  message: string;
  totalVertices: number;
  deletedVertices: number;
  batches: number;
  cancelRequested: boolean;
  serverCancellation?: boolean;
  exportedBytes?: number;
  exportOutputStarted?: boolean;
  updatedAt: string;
};

export const serverTransferTaskStorageKey = "janus-studio.transfer.server-task";

type SessionStorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function readServerTransferTask(storage: SessionStorageLike): ServerTransferTask | null {
  try {
    const value = JSON.parse(storage.getItem(serverTransferTaskStorageKey) ?? "null") as Partial<ServerTransferTask> | null;
    if (!value?.id || !value.action || !value.status || !value.stage || !value.connectionId || !value.graphName) return null;
    return {
      id: value.id,
      action: value.action,
      status: value.status,
      stage: value.stage,
      connectionId: value.connectionId,
      graphName: value.graphName,
      graphAccess: value.graphAccess === "binding" ? "binding" : "configured",
      message: typeof value.message === "string" ? value.message : "",
      totalVertices: Number.isSafeInteger(value.totalVertices) ? value.totalVertices! : 0,
      deletedVertices: Number.isSafeInteger(value.deletedVertices) ? value.deletedVertices! : 0,
      batches: Number.isSafeInteger(value.batches) ? value.batches! : 0,
      cancelRequested: value.cancelRequested === true,
      ...(typeof value.serverCancellation === "boolean"
        ? { serverCancellation: value.serverCancellation }
        : {}),
      ...(Number.isSafeInteger(value.exportedBytes) && value.exportedBytes! >= 0
        ? { exportedBytes: value.exportedBytes }
        : {}),
      ...(typeof value.exportOutputStarted === "boolean"
        ? { exportOutputStarted: value.exportOutputStarted }
        : {}),
      updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

export function writeServerTransferTask(storage: SessionStorageLike, task: ServerTransferTask | null): void {
  if (task) storage.setItem(serverTransferTaskStorageKey, JSON.stringify(task));
  else storage.removeItem(serverTransferTaskStorageKey);
}

export function requestServerTransferTaskCancellation(
  storage: SessionStorageLike,
  taskId: string,
): ServerTransferTask | null {
  const task = readServerTransferTask(storage);
  if (!task || task.id !== taskId || task.status !== "running") return null;
  const next = {
    ...task,
    cancelRequested: true,
    message: "Cancellation requested",
    updatedAt: new Date().toISOString(),
  };
  writeServerTransferTask(storage, next);
  return next;
}

export function serverTransferTaskPublication(
  task: ServerTransferTask,
): PublishBackgroundTaskInput {
  const status = task.status === "stopped"
    ? "interrupted"
    : task.cancelRequested && task.status === "running"
      ? "cancel_requested"
      : task.status;
  return {
    id: task.id,
    kind: "transfer",
    action: task.action,
    title: task.graphName,
    connectionId: task.connectionId,
    graphName: task.graphName,
    status,
    stage: task.stage,
    message: task.message,
    progressCurrent: task.action === "purge"
      ? task.deletedVertices
      : task.action === "export" ? task.exportedBytes ?? 0 : 0,
    progressTotal: task.action === "purge" ? task.totalVertices : 0,
    progressUnit: task.action === "purge" ? "vertex" : task.action === "export" ? "byte" : "file",
    cancellable: task.status === "running" && !task.cancelRequested,
    retriable: task.status === "failed" || task.status === "stopped",
  };
}
