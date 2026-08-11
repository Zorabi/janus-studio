import type { SchemaJob } from "@janusgraph/domain";

export const BACKGROUND_SCHEMA_TASK_STORAGE_KEY = "janusgraph.schemaImport.background.v1";

export type BackgroundSchemaTask = {
  connectionId: string;
  fileName: string;
  startedAt: string;
  jobId?: string;
};

export function parseBackgroundSchemaTask(value: string | null): BackgroundSchemaTask | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<BackgroundSchemaTask>;
    if (
      typeof parsed.connectionId !== "string" ||
      typeof parsed.fileName !== "string" ||
      typeof parsed.startedAt !== "string" ||
      !Number.isFinite(Date.parse(parsed.startedAt)) ||
      (parsed.jobId !== undefined && typeof parsed.jobId !== "string")
    ) return null;
    return parsed as BackgroundSchemaTask;
  } catch {
    return null;
  }
}

export function findBackgroundSchemaJob(
  jobs: SchemaJob[],
  task: BackgroundSchemaTask | null,
): SchemaJob | undefined {
  if (!task) return undefined;
  if (task.jobId) return jobs.find((job) => job.id === task.jobId);
  const earliest = Date.parse(task.startedAt) - 5_000;
  return jobs.find((job) =>
    job.action === "IMPORT_SCHEMA" &&
    job.connectionId === task.connectionId &&
    job.indexName === task.fileName &&
    Date.parse(job.createdAt) >= earliest,
  );
}
