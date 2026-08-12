import type {
  BackgroundTask,
  BackgroundTaskStatus,
  PublishBackgroundTaskInput,
  SchemaJob,
} from "@janusgraph/domain";
import type { DatabaseSync } from "node:sqlite";

type BackgroundTaskRow = {
  id: string;
  kind: BackgroundTask["kind"];
  action: string;
  title: string;
  connection_id: string;
  connection_name: string;
  graph_name: string;
  status: BackgroundTaskStatus;
  stage: string;
  message: string;
  progress_current: number;
  progress_total: number;
  progress_unit: string;
  cancellable: number;
  retriable: number;
  acknowledged: number;
  created_at: string;
  updated_at: string;
  completed_at: string;
};

const terminalStatuses = new Set<BackgroundTaskStatus>([
  "succeeded",
  "failed",
  "interrupted",
]);

function schemaProgress(message: string): { current: number; total: number } {
  const completed = message.match(/Completed\s+(\d+)\/(\d+)/i);
  if (completed) return { current: Number(completed[1]), total: Number(completed[2]) };
  const running = message.match(/Running batch\s+(\d+)\/(\d+)/i);
  if (running) return { current: Math.max(Number(running[1]) - 1, 0), total: Number(running[2]) };
  const failed = message.match(/Batch\s+(\d+)\/(\d+)\s+failed/i);
  if (failed) return { current: Math.max(Number(failed[1]) - 1, 0), total: Number(failed[2]) };
  const stopped = message.match(/Stopped after\s+(\d+)\/(\d+)/i);
  if (stopped) return { current: Number(stopped[1]), total: Number(stopped[2]) };
  return { current: 0, total: 0 };
}

const toTask = (row: BackgroundTaskRow): BackgroundTask => ({
  id: row.id,
  kind: row.kind,
  action: row.action,
  title: row.title,
  connectionId: row.connection_id,
  connectionName: row.connection_name,
  graphName: row.graph_name,
  status: row.status,
  stage: row.stage,
  message: row.message,
  progressCurrent: row.progress_current,
  progressTotal: row.progress_total,
  progressUnit: row.progress_unit,
  cancellable: row.cancellable === 1,
  retriable: row.retriable === 1,
  acknowledged: row.acknowledged === 1,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  completedAt: row.completed_at,
});

export class BackgroundTaskRepository {
  constructor(private readonly database: DatabaseSync) {}

  list(limit = 200): BackgroundTask[] {
    return (this.database.prepare(
      "SELECT * FROM background_tasks ORDER BY updated_at DESC LIMIT ?",
    ).all(limit) as BackgroundTaskRow[]).map(toTask);
  }

  get(id: string): BackgroundTask | undefined {
    const row = this.database.prepare(
      "SELECT * FROM background_tasks WHERE id = ?",
    ).get(id) as BackgroundTaskRow | undefined;
    return row ? toTask(row) : undefined;
  }

  publish(input: PublishBackgroundTaskInput, connectionName: string): BackgroundTask {
    const previous = this.get(input.id);
    const now = new Date().toISOString();
    const isTerminal = terminalStatuses.has(input.status);
    const task: BackgroundTask = {
      ...input,
      connectionName,
      acknowledged:
        previous?.status === input.status ? previous.acknowledged : !isTerminal,
      createdAt: previous?.createdAt ?? now,
      updatedAt: now,
      completedAt: isTerminal ? previous?.completedAt || now : "",
    };
    this.upsert(task);
    return this.get(task.id)!;
  }

  syncSchema(job: SchemaJob): BackgroundTask {
    const previous = this.get(job.id);
    const isTerminal = job.status !== "running";
    const progress = schemaProgress(job.message);
    const task: BackgroundTask = {
      id: job.id,
      kind: "schema",
      action: job.action,
      title: job.indexName,
      connectionId: job.connectionId,
      connectionName: job.connectionName,
      graphName: "",
      status: job.status,
      stage: job.status === "running" ? "executing" : "completed",
      message: job.message,
      progressCurrent: progress.current,
      progressTotal: progress.total,
      progressUnit: "batch",
      cancellable: job.status === "running",
      retriable: job.status === "failed" || job.status === "interrupted",
      acknowledged:
        previous?.status === job.status ? previous.acknowledged : !isTerminal,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      completedAt: isTerminal ? previous?.completedAt || job.updatedAt : "",
    };
    this.upsert(task);
    return this.get(task.id)!;
  }

  acknowledge(id?: string): void {
    if (id) {
      this.database.prepare(
        "UPDATE background_tasks SET acknowledged = 1 WHERE id = ?",
      ).run(id);
      return;
    }
    this.database.exec("UPDATE background_tasks SET acknowledged = 1");
  }

  dismiss(id: string): void {
    const task = this.get(id);
    if (!task) return;
    if (task.status === "running" || task.status === "cancel_requested") {
      throw new Error("Running task cannot be dismissed");
    }
    this.database.prepare("DELETE FROM background_tasks WHERE id = ?").run(id);
  }

  private upsert(task: BackgroundTask): void {
    this.database.prepare(`
      INSERT OR REPLACE INTO background_tasks (
        id, kind, action, title, connection_id, connection_name, graph_name,
        status, stage, message, progress_current, progress_total, progress_unit,
        cancellable, retriable, acknowledged, created_at, updated_at, completed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      task.id, task.kind, task.action, task.title, task.connectionId,
      task.connectionName, task.graphName, task.status, task.stage, task.message,
      task.progressCurrent, task.progressTotal, task.progressUnit,
      task.cancellable ? 1 : 0, task.retriable ? 1 : 0,
      task.acknowledged ? 1 : 0, task.createdAt, task.updatedAt, task.completedAt,
    );
  }
}
