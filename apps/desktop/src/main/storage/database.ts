import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

export function openApplicationDatabase(path: string): DatabaseSync {
  mkdirSync(dirname(path), { recursive: true });

  const database = new DatabaseSync(path);
  database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS connection_profiles (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      protocol TEXT NOT NULL,
      host TEXT NOT NULL,
      port INTEGER NOT NULL,
      path TEXT NOT NULL,
      username TEXT NOT NULL,
      environment TEXT NOT NULL DEFAULT 'dev',
      connection_read_only INTEGER NOT NULL DEFAULT 0,
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

    CREATE INDEX IF NOT EXISTS idx_connection_profiles_updated_at
      ON connection_profiles(updated_at DESC);

    CREATE TABLE IF NOT EXISTS query_history (
      id TEXT PRIMARY KEY,
      connection_id TEXT NOT NULL,
      connection_name TEXT NOT NULL,
      query_text TEXT NOT NULL,
      status TEXT NOT NULL,
      duration_ms INTEGER NOT NULL,
      result_count INTEGER NOT NULL,
      error_message TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_query_history_created_at
      ON query_history(created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_query_history_connection_id
      ON query_history(connection_id, created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_query_history_status_created_at
      ON query_history(status, created_at DESC);

    CREATE TABLE IF NOT EXISTS schema_jobs (
      id TEXT PRIMARY KEY,
      connection_id TEXT NOT NULL,
      connection_name TEXT NOT NULL,
      index_name TEXT NOT NULL,
      action TEXT NOT NULL,
      query_text TEXT NOT NULL,
      status TEXT NOT NULL,
      message TEXT NOT NULL,
      duration_ms INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_schema_jobs_connection_created
      ON schema_jobs(connection_id, created_at DESC);

  `);

  const connectionColumns = database
    .prepare("PRAGMA table_info(connection_profiles)")
    .all() as Array<{ name: string }>;
  if (!connectionColumns.some((column) => column.name === "client_mode")) {
    database.exec(
      "ALTER TABLE connection_profiles ADD COLUMN client_mode TEXT NOT NULL DEFAULT 'sessionless'",
    );
  }
  if (!connectionColumns.some((column) => column.name === "tls_reject_unauthorized")) {
    database.exec("ALTER TABLE connection_profiles ADD COLUMN tls_reject_unauthorized INTEGER NOT NULL DEFAULT 1");
  }
  if (!connectionColumns.some((column) => column.name === "enable_compression")) {
    database.exec("ALTER TABLE connection_profiles ADD COLUMN enable_compression INTEGER NOT NULL DEFAULT 0");
  }
  if (!connectionColumns.some((column) => column.name === "custom_headers")) {
    database.exec("ALTER TABLE connection_profiles ADD COLUMN custom_headers TEXT NOT NULL DEFAULT '{}'");
  }
  if (!connectionColumns.some((column) => column.name === "environment")) {
    database.exec("ALTER TABLE connection_profiles ADD COLUMN environment TEXT NOT NULL DEFAULT 'dev'");
  }
  if (!connectionColumns.some((column) => column.name === "connection_read_only")) {
    database.exec("ALTER TABLE connection_profiles ADD COLUMN connection_read_only INTEGER NOT NULL DEFAULT 0");
  }
  database.exec("UPDATE schema_jobs SET status = 'interrupted', message = 'Application closed before the operation completed', updated_at = datetime('now') WHERE status = 'running';");
  database.exec("PRAGMA user_version = 6;");

  return database;
}
