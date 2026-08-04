import type { QueryHistoryEntry } from "@janusgraph/domain";
import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

type HistoryRow = {
  id: string;
  connection_id: string;
  connection_name: string;
  query_text: string;
  status: QueryHistoryEntry["status"];
  duration_ms: number;
  result_count: number;
  error_message: string;
  created_at: string;
};

function toEntry(row: HistoryRow): QueryHistoryEntry {
  return {
    id: row.id,
    connectionId: row.connection_id,
    connectionName: row.connection_name,
    query: row.query_text,
    status: row.status,
    durationMs: row.duration_ms,
    resultCount: row.result_count,
    errorMessage: row.error_message,
    createdAt: row.created_at,
  };
}

export class HistoryRepository {
  constructor(private readonly database: DatabaseSync) {}

  list(limit = 200): QueryHistoryEntry[] {
    const safeLimit = Math.max(1, Math.min(limit, 1_000));
    const rows = this.database
      .prepare("SELECT * FROM query_history ORDER BY created_at DESC LIMIT ?")
      .all(safeLimit) as HistoryRow[];
    return rows.map(toEntry);
  }

  add(
    connectionId: string,
    connectionName: string,
    query: string,
    status: QueryHistoryEntry["status"],
    durationMs: number,
    resultCount: number,
    errorMessage = "",
  ): QueryHistoryEntry {
    const entry: QueryHistoryEntry = {
      id: randomUUID(),
      connectionId,
      connectionName,
      query,
      status,
      durationMs,
      resultCount,
      errorMessage,
      createdAt: new Date().toISOString(),
    };
    this.database
      .prepare(`
        INSERT INTO query_history (
          id, connection_id, connection_name, query_text, status,
          duration_ms, result_count, error_message, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        entry.id,
        entry.connectionId,
        entry.connectionName,
        entry.query,
        entry.status,
        entry.durationMs,
        entry.resultCount,
        entry.errorMessage,
        entry.createdAt,
      );
    return entry;
  }

  remove(id: string): void {
    this.database.prepare("DELETE FROM query_history WHERE id = ?").run(id);
  }

  clear(): void {
    this.database.exec("DELETE FROM query_history");
  }
}
