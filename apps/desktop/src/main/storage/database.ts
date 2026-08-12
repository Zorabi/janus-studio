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

    CREATE TABLE IF NOT EXISTS background_tasks (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      action TEXT NOT NULL,
      title TEXT NOT NULL,
      connection_id TEXT NOT NULL,
      connection_name TEXT NOT NULL,
      graph_name TEXT NOT NULL,
      status TEXT NOT NULL,
      stage TEXT NOT NULL,
      message TEXT NOT NULL,
      progress_current INTEGER NOT NULL DEFAULT 0,
      progress_total INTEGER NOT NULL DEFAULT 0,
      progress_unit TEXT NOT NULL,
      cancellable INTEGER NOT NULL DEFAULT 0,
      retriable INTEGER NOT NULL DEFAULT 0,
      acknowledged INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_background_tasks_updated
      ON background_tasks(updated_at DESC);

    CREATE INDEX IF NOT EXISTS idx_background_tasks_status_updated
      ON background_tasks(status, updated_at DESC);

    CREATE TABLE IF NOT EXISTS graph_transfer_runs (
      task_id TEXT PRIMARY KEY,
      input_json TEXT NOT NULL,
      recovery_json TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS query_asset_tags (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL COLLATE NOCASE UNIQUE,
      color TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS query_asset_folders (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      parent_id TEXT REFERENCES query_asset_folders(id) ON DELETE SET NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_query_asset_folders_parent_sort
      ON query_asset_folders(parent_id, sort_order, name COLLATE NOCASE);

    CREATE TABLE IF NOT EXISTS query_snippets (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      query_text TEXT NOT NULL,
      bindings_text TEXT NOT NULL,
      connection_id TEXT NOT NULL,
      graph_name TEXT NOT NULL,
      folder_id TEXT REFERENCES query_asset_folders(id) ON DELETE SET NULL,
      starred INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_query_snippets_updated
      ON query_snippets(updated_at DESC);

    CREATE INDEX IF NOT EXISTS idx_query_snippets_folder_updated
      ON query_snippets(folder_id, updated_at DESC);

    CREATE TABLE IF NOT EXISTS query_snippet_tags (
      snippet_id TEXT NOT NULL REFERENCES query_snippets(id) ON DELETE CASCADE,
      tag_id TEXT NOT NULL REFERENCES query_asset_tags(id) ON DELETE CASCADE,
      PRIMARY KEY (snippet_id, tag_id)
    );

    CREATE INDEX IF NOT EXISTS idx_query_snippet_tags_tag
      ON query_snippet_tags(tag_id, snippet_id);

    CREATE TABLE IF NOT EXISTS query_history_assets (
      history_id TEXT PRIMARY KEY REFERENCES query_history(id) ON DELETE CASCADE,
      starred INTEGER NOT NULL DEFAULT 0,
      note TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS query_history_tags (
      history_id TEXT NOT NULL REFERENCES query_history(id) ON DELETE CASCADE,
      tag_id TEXT NOT NULL REFERENCES query_asset_tags(id) ON DELETE CASCADE,
      PRIMARY KEY (history_id, tag_id)
    );

    CREATE INDEX IF NOT EXISTS idx_query_history_tags_tag
      ON query_history_tags(tag_id, history_id);

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
  database.exec("UPDATE background_tasks SET status = 'interrupted', message = 'Application closed before the operation completed', cancellable = 0, retriable = 1, acknowledged = 0, completed_at = datetime('now'), updated_at = datetime('now') WHERE status IN ('running', 'cancel_requested');");
  database.exec(`
    INSERT OR IGNORE INTO background_tasks (
      id, kind, action, title, connection_id, connection_name, graph_name,
      status, stage, message, progress_current, progress_total, progress_unit,
      cancellable, retriable, acknowledged, created_at, updated_at, completed_at
    )
    SELECT id, 'schema', action, index_name, connection_id, connection_name, '',
      status, CASE WHEN status = 'running' THEN 'executing' ELSE 'completed' END,
      message, 0, 0, 'batch', CASE WHEN status = 'running' THEN 1 ELSE 0 END,
      CASE WHEN status IN ('failed', 'interrupted') THEN 1 ELSE 0 END,
      CASE WHEN status = 'running' THEN 1 ELSE 0 END, created_at, updated_at,
      CASE WHEN status = 'running' THEN '' ELSE updated_at END
    FROM schema_jobs;
  `);
  database.exec("PRAGMA user_version = 9;");

  return database;
}
