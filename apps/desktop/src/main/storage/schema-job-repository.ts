import type { RunSchemaJobInput, SchemaJob, SchemaJobStatus } from "@janusgraph/domain";
import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

type SchemaJobRow = {
  id: string; connection_id: string; connection_name: string; index_name: string;
  action: string; query_text: string; status: SchemaJobStatus; message: string;
  duration_ms: number; created_at: string; updated_at: string;
};

const toJob = (row: SchemaJobRow): SchemaJob => ({
  id: row.id,
  connectionId: row.connection_id,
  connectionName: row.connection_name,
  indexName: row.index_name,
  action: row.action,
  query: row.query_text,
  status: row.status,
  message: row.message,
  durationMs: row.duration_ms,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export class SchemaJobRepository {
  constructor(private readonly database: DatabaseSync) {}

  list(connectionId?: string, limit = 100): SchemaJob[] {
    const rows = connectionId
      ? this.database.prepare("SELECT * FROM schema_jobs WHERE connection_id = ? ORDER BY created_at DESC LIMIT ?").all(connectionId, limit)
      : this.database.prepare("SELECT * FROM schema_jobs ORDER BY created_at DESC LIMIT ?").all(limit);
    return (rows as SchemaJobRow[]).map(toJob);
  }

  get(id: string): SchemaJob | undefined {
    const row = this.database.prepare("SELECT * FROM schema_jobs WHERE id = ?").get(id) as SchemaJobRow | undefined;
    return row ? toJob(row) : undefined;
  }

  create(input: RunSchemaJobInput, connectionName: string): SchemaJob {
    const now = new Date().toISOString();
    const job: SchemaJob = {
      id: randomUUID(), connectionId: input.connectionId, connectionName,
      indexName: input.indexName, action: input.action, query: input.query,
      status: "running", message: "", durationMs: 0, createdAt: now, updatedAt: now,
    };
    this.database.prepare(`INSERT INTO schema_jobs (
      id, connection_id, connection_name, index_name, action, query_text,
      status, message, duration_ms, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      job.id, job.connectionId, job.connectionName, job.indexName, job.action,
      job.query, job.status, job.message, job.durationMs, job.createdAt, job.updatedAt,
    );
    return job;
  }

  finish(id: string, status: "succeeded" | "failed", message: string, durationMs: number): SchemaJob {
    this.database.prepare("UPDATE schema_jobs SET status = ?, message = ?, duration_ms = ?, updated_at = ? WHERE id = ?")
      .run(status, message, durationMs, new Date().toISOString(), id);
    const job = this.get(id);
    if (!job) throw new Error("Schema job not found");
    return job;
  }
}
