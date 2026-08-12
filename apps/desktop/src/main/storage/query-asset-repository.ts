import type {
  QueryAssetFolder,
  QueryAssetTag,
  QueryHistoryAssetMetadata,
  QuerySnippet,
  QuerySnippetListInput,
  SaveQueryAssetFolderInput,
  SaveQueryAssetTagInput,
  SaveQueryHistoryAssetInput,
  SaveQuerySnippetInput,
} from "@janusgraph/domain";
import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

type TagRow = { id: string; name: string; color: string; created_at: string; updated_at: string };
type FolderRow = { id: string; name: string; parent_id: string | null; sort_order: number; created_at: string; updated_at: string };
type SnippetRow = {
  id: string; name: string; description: string; query_text: string; bindings_text: string;
  connection_id: string; graph_name: string; folder_id: string | null; starred: number;
  created_at: string; updated_at: string;
};

const tag = (row: TagRow): QueryAssetTag => ({
  id: row.id, name: row.name, color: row.color, createdAt: row.created_at, updatedAt: row.updated_at,
});

const folder = (row: FolderRow): QueryAssetFolder => ({
  id: row.id, name: row.name, parentId: row.parent_id ?? "", sortOrder: row.sort_order,
  createdAt: row.created_at, updatedAt: row.updated_at,
});

export class QueryAssetRepository {
  constructor(private readonly database: DatabaseSync) {}

  listTags(): QueryAssetTag[] {
    return (this.database.prepare("SELECT * FROM query_asset_tags ORDER BY name COLLATE NOCASE, id").all() as TagRow[]).map(tag);
  }

  saveTag(input: SaveQueryAssetTagInput): QueryAssetTag {
    const id = input.id ?? randomUUID();
    const previous = this.database.prepare("SELECT created_at FROM query_asset_tags WHERE id = ?").get(id) as { created_at: string } | undefined;
    const now = new Date().toISOString();
    this.database.prepare(`
      INSERT INTO query_asset_tags (id, name, color, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET name = excluded.name, color = excluded.color, updated_at = excluded.updated_at
    `).run(id, input.name, input.color, previous?.created_at ?? now, now);
    return tag(this.database.prepare("SELECT * FROM query_asset_tags WHERE id = ?").get(id) as TagRow);
  }

  removeTag(id: string): void {
    this.database.prepare("DELETE FROM query_asset_tags WHERE id = ?").run(id);
  }

  listFolders(): QueryAssetFolder[] {
    return (this.database.prepare(`
      SELECT * FROM query_asset_folders
      ORDER BY CASE WHEN parent_id IS NULL THEN 0 ELSE 1 END, parent_id, sort_order, name COLLATE NOCASE, id
    `).all() as FolderRow[]).map(folder);
  }

  saveFolder(input: SaveQueryAssetFolderInput): QueryAssetFolder {
    const id = input.id ?? randomUUID();
    const parentId = input.parentId || null;
    if (parentId === id) throw new Error("文件夹不能作为自身的父级");
    if (parentId) this.assertFolderParent(id, parentId);
    const previous = this.database.prepare("SELECT created_at FROM query_asset_folders WHERE id = ?").get(id) as { created_at: string } | undefined;
    const now = new Date().toISOString();
    this.database.prepare(`
      INSERT INTO query_asset_folders (id, name, parent_id, sort_order, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET name = excluded.name, parent_id = excluded.parent_id,
        sort_order = excluded.sort_order, updated_at = excluded.updated_at
    `).run(id, input.name, parentId, input.sortOrder, previous?.created_at ?? now, now);
    return folder(this.database.prepare("SELECT * FROM query_asset_folders WHERE id = ?").get(id) as FolderRow);
  }

  removeFolder(id: string): void {
    this.database.prepare("DELETE FROM query_asset_folders WHERE id = ?").run(id);
  }

  listSnippets(input: QuerySnippetListInput = {}): QuerySnippet[] {
    const conditions: string[] = [];
    const parameters: Array<string | number> = [];
    if (input.search?.trim()) {
      const pattern = `%${input.search.trim().replace(/[\\%_]/g, "\\$&")}%`;
      conditions.push("(name LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\' OR query_text LIKE ? ESCAPE '\\' OR graph_name LIKE ? ESCAPE '\\')");
      parameters.push(pattern, pattern, pattern, pattern);
    }
    if (input.folderId !== undefined) {
      conditions.push(input.folderId ? "folder_id = ?" : "folder_id IS NULL");
      if (input.folderId) parameters.push(input.folderId);
    }
    if (input.starred !== undefined) {
      conditions.push("starred = ?");
      parameters.push(input.starred ? 1 : 0);
    }
    for (const tagId of [...new Set(input.tagIds ?? [])]) {
      conditions.push("EXISTS (SELECT 1 FROM query_snippet_tags qst WHERE qst.snippet_id = query_snippets.id AND qst.tag_id = ?)");
      parameters.push(tagId);
    }
    const limit = Math.max(1, Math.min(input.limit ?? 200, 1_000));
    const offset = Math.max(0, input.offset ?? 0);
    const rows = this.database.prepare(`
      SELECT * FROM query_snippets
      ${conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""}
      ORDER BY starred DESC, updated_at DESC, name COLLATE NOCASE
      LIMIT ? OFFSET ?
    `).all(...parameters, limit, offset) as SnippetRow[];
    const tags = this.tagsByOwner("snippet", rows.map((row) => row.id));
    return rows.map((row) => this.snippet(row, tags.get(row.id) ?? []));
  }

  saveSnippet(input: SaveQuerySnippetInput): QuerySnippet {
    const id = input.id ?? randomUUID();
    const now = new Date().toISOString();
    const previous = this.database.prepare("SELECT created_at FROM query_snippets WHERE id = ?").get(id) as { created_at: string } | undefined;
    this.transaction(() => {
      this.database.prepare(`
        INSERT INTO query_snippets (
          id, name, description, query_text, bindings_text, connection_id, graph_name,
          folder_id, starred, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET name = excluded.name, description = excluded.description,
          query_text = excluded.query_text, bindings_text = excluded.bindings_text,
          connection_id = excluded.connection_id, graph_name = excluded.graph_name,
          folder_id = excluded.folder_id, starred = excluded.starred, updated_at = excluded.updated_at
      `).run(
        id, input.name, input.description, input.query, input.bindingsText, input.connectionId,
        input.graphName, input.folderId || null, input.starred ? 1 : 0, previous?.created_at ?? now, now,
      );
      this.replaceTags("query_snippet_tags", "snippet_id", id, input.tagIds ?? []);
    });
    return this.listSnippets({ limit: 1, search: undefined }).find((snippet) => snippet.id === id)
      ?? this.snippet(this.database.prepare("SELECT * FROM query_snippets WHERE id = ?").get(id) as SnippetRow, this.tagsByOwner("snippet", [id]).get(id) ?? []);
  }

  removeSnippet(id: string): void {
    this.database.prepare("DELETE FROM query_snippets WHERE id = ?").run(id);
  }

  historyMetadata(historyIds: string[]): QueryHistoryAssetMetadata[] {
    const ids = [...new Set(historyIds)];
    if (ids.length === 0) return [];
    const rows = this.database.prepare(`
      SELECT history_id, starred, note, updated_at FROM query_history_assets
      WHERE history_id IN (${ids.map(() => "?").join(", ")})
    `).all(...ids) as Array<{ history_id: string; starred: number; note: string; updated_at: string }>;
    const tags = this.tagsByOwner("history", ids);
    return rows.map((row) => ({
      historyId: row.history_id, starred: row.starred === 1, note: row.note,
      tags: tags.get(row.history_id) ?? [], updatedAt: row.updated_at,
    }));
  }

  saveHistoryMetadata(input: SaveQueryHistoryAssetInput): QueryHistoryAssetMetadata {
    const now = new Date().toISOString();
    this.transaction(() => {
      this.database.prepare(`
        INSERT INTO query_history_assets (history_id, starred, note, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(history_id) DO UPDATE SET starred = excluded.starred, note = excluded.note, updated_at = excluded.updated_at
      `).run(input.historyId, input.starred ? 1 : 0, input.note, now);
      this.replaceTags("query_history_tags", "history_id", input.historyId, input.tagIds);
    });
    return this.historyMetadata([input.historyId])[0]!;
  }

  private snippet(row: SnippetRow, tags: QueryAssetTag[]): QuerySnippet {
    return {
      id: row.id, name: row.name, description: row.description, query: row.query_text,
      bindingsText: row.bindings_text, connectionId: row.connection_id, graphName: row.graph_name,
      folderId: row.folder_id ?? "", starred: row.starred === 1, tags,
      createdAt: row.created_at, updatedAt: row.updated_at,
    };
  }

  private tagsByOwner(owner: "snippet" | "history", ownerIds: string[]): Map<string, QueryAssetTag[]> {
    const result = new Map<string, QueryAssetTag[]>();
    if (ownerIds.length === 0) return result;
    const table = owner === "snippet" ? "query_snippet_tags" : "query_history_tags";
    const column = owner === "snippet" ? "snippet_id" : "history_id";
    const rows = this.database.prepare(`
      SELECT links.${column} owner_id, tags.* FROM ${table} links
      JOIN query_asset_tags tags ON tags.id = links.tag_id
      WHERE links.${column} IN (${ownerIds.map(() => "?").join(", ")})
      ORDER BY tags.name COLLATE NOCASE
    `).all(...ownerIds) as Array<TagRow & { owner_id: string }>;
    for (const row of rows) result.set(row.owner_id, [...(result.get(row.owner_id) ?? []), tag(row)]);
    return result;
  }

  private replaceTags(table: string, ownerColumn: string, ownerId: string, tagIds: string[]): void {
    this.database.prepare(`DELETE FROM ${table} WHERE ${ownerColumn} = ?`).run(ownerId);
    const insert = this.database.prepare(`INSERT INTO ${table} (${ownerColumn}, tag_id) VALUES (?, ?)`);
    for (const tagId of [...new Set(tagIds)]) insert.run(ownerId, tagId);
  }

  private assertFolderParent(id: string, parentId: string): void {
    const rows = this.database.prepare(`
      WITH RECURSIVE ancestors(id, parent_id) AS (
        SELECT id, parent_id FROM query_asset_folders WHERE id = ?
        UNION ALL
        SELECT folders.id, folders.parent_id FROM query_asset_folders folders
        JOIN ancestors ON folders.id = ancestors.parent_id
      ) SELECT id FROM ancestors
    `).all(parentId) as Array<{ id: string }>;
    if (rows.length === 0) throw new Error("父文件夹不存在");
    if (rows.some((row) => row.id === id)) throw new Error("文件夹层级不能形成循环");
  }

  private transaction(work: () => void): void {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      work();
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }
}
