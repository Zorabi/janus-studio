import type {
  ConnectionSummary,
  QueryAssetFolder,
  QueryAssetTag,
  QueryHistoryAssetEntry,
  QueryHistoryStatus,
  QuerySnippet,
  SaveQuerySnippetInput,
} from "@janusgraph/domain";
import {
  Archive,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Code2,
  Edit3,
  FileCode2,
  Folder,
  FolderPlus,
  GripVertical,
  History,
  Layers3,
  LoaderCircle,
  Plus,
  Search,
  Sparkles,
  Star,
  Tag,
  Tags,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { SelectControl } from "../../components/SelectControl";
import { EmptyState, Modal, PageHeader } from "../../components/ui";
import { useLocale, useTranslate } from "../../lib/i18n";
import { errorMessage, formatDate } from "../../lib/presentation";
import { loadSavedQueries, saveSavedQueries, type SavedQuery, type ToastState } from "../query/query-workspace";
import type { HistoryDateFilter, HistoryStatusFilter } from "./history-filters";

type AssetView = "all" | "history" | "snippets" | "starred";
type SelectedAsset = { kind: "history"; value: QueryHistoryAssetEntry } | { kind: "snippet"; value: QuerySnippet } | null;

const pageSize = 100;
const tagColors = ["#c8ff55", "#83bcff", "#efb45e", "#ff746a", "#b8a3ff", "#69dfb0"];
type BuiltInTemplate = Pick<QuerySnippet, "name" | "description" | "query" | "bindingsText">;

function emptySnippet(connectionId = "", graphName = "", traversalSource = ""): SaveQuerySnippetInput {
  return {
    name: "", description: "", query: "", bindingsText: "{}", connectionId,
    graphName, traversalSource, folderId: "", starred: false, tagIds: [],
  };
}

export interface HistoryPageProps {
  connections: ConnectionSummary[];
  activeConnectionId: string;
  onOpenHistory: (entry: QueryHistoryAssetEntry) => void;
  onOpenSnippet: (snippet: QuerySnippet) => void;
  notify: (toast: ToastState) => void;
}

export function HistoryPage({ connections, activeConnectionId, onOpenHistory, onOpenSnippet, notify }: HistoryPageProps) {
  const t = useTranslate();
  const locale = useLocale();
  const [view, setView] = useState<AssetView>("all");
  const [search, setSearch] = useState("");
  const [connectionId, setConnectionId] = useState("");
  const [status, setStatus] = useState<HistoryStatusFilter>("all");
  const [date, setDate] = useState<HistoryDateFilter>("all");
  const [folderId, setFolderId] = useState<string | undefined>(undefined);
  const [tagId, setTagId] = useState("");
  const [historyPage, setHistoryPage] = useState(0);
  const [history, setHistory] = useState<QueryHistoryAssetEntry[]>([]);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [snippets, setSnippets] = useState<QuerySnippet[]>([]);
  const [tags, setTags] = useState<QueryAssetTag[]>([]);
  const [folders, setFolders] = useState<QueryAssetFolder[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<SelectedAsset>(null);
  const [selectedHistoryIds, setSelectedHistoryIds] = useState<Set<string>>(new Set());
  const [snippetDraft, setSnippetDraft] = useState<SaveQuerySnippetInput | null>(null);
  const [historyNote, setHistoryNote] = useState("");
  const [newFolderName, setNewFolderName] = useState("");
  const [newTagName, setNewTagName] = useState("");
  const [bulkTagId, setBulkTagId] = useState("");
  const [legacyQueries, setLegacyQueries] = useState<SavedQuery[]>(loadSavedQueries);
  const [migrationOpen, setMigrationOpen] = useState(false);
  const [deleteSnippet, setDeleteSnippet] = useState<QuerySnippet | null>(null);
  const [deleteHistoryOpen, setDeleteHistoryOpen] = useState(false);
  const [editingFolder, setEditingFolder] = useState<QueryAssetFolder | null>(null);
  const [editingTag, setEditingTag] = useState<QueryAssetTag | null>(null);
  const [editName, setEditName] = useState("");
  const [editParentId, setEditParentId] = useState("");
  const [editColor, setEditColor] = useState(tagColors[0]!);
  const [draggingSnippetId, setDraggingSnippetId] = useState("");
  const [dragTargetFolderId, setDragTargetFolderId] = useState<string | null>(null);
  const builtInTemplates = useMemo<BuiltInTemplate[]>(() => [
    { name: t("按标签统计顶点", "Count vertices by label"), description: t("统计每种 Vertex Label 的数量", "Count vertices for every Vertex Label"), query: "g.V().groupCount().by(label)", bindingsText: "{}" },
    { name: t("查询相邻顶点", "Find adjacent vertices"), description: t("使用 vertexId 查询双向邻居", "Find bidirectional neighbors by vertexId"), query: "g.V(vertexId).both().dedup().limit(limit)", bindingsText: "{\n  \"vertexId\": 1,\n  \"limit\": 50\n}" },
    { name: t("最短路径", "Shortest path"), description: t("使用起点和终点 ID 查找简单路径", "Find a simple path between two vertex IDs"), query: "g.V(fromId).repeat(both().simplePath()).until(hasId(toId)).path().limit(1)", bindingsText: "{\n  \"fromId\": 1,\n  \"toId\": 2\n}" },
    { name: t("查看 Schema", "Inspect Schema"), description: t("输出当前图的完整 Schema", "Print the complete Schema for the current graph"), query: "graph.openManagement().printSchema()", bindingsText: "{}" },
  ], [t]);

  const graphNameFor = (id: string) => connections.find((item) => item.id === id)?.graphBinding ?? "";
  const traversalFor = (id: string) => connections.find((item) => item.id === id)?.traversalSource ?? "";
  const dateRange = useMemo(() => {
    if (date === "all") return {};
    const start = new Date();
    if (date === "today") start.setHours(0, 0, 0, 0);
    else start.setDate(start.getDate() - (date === "7d" ? 7 : 30));
    return { createdFrom: start.toISOString() };
  }, [date]);
  const folderDepth = useMemo(() => {
    const parents = new Map(folders.map((folder) => [folder.id, folder.parentId]));
    return new Map(folders.map((folder) => {
      let depth = 0; let parent = folder.parentId; const visited = new Set<string>([folder.id]);
      while (parent && !visited.has(parent) && depth < 8) { visited.add(parent); depth += 1; parent = parents.get(parent) ?? ""; }
      return [folder.id, depth] as const;
    }));
  }, [folders]);

  const loadAssets = useCallback(async () => {
    if (!window.janusGraphDesktop) return;
    setLoading(true);
    try {
      const historyInput = {
        limit: pageSize,
        offset: historyPage * pageSize,
        search: search.trim() || undefined,
        connectionId: connectionId || undefined,
        statuses: status === "all" ? undefined : [status],
        tagIds: tagId ? [tagId] : undefined,
        starred: view === "starred" ? true : undefined,
        ...dateRange,
      };
      const snippetInput = {
        limit: 500,
        search: search.trim() || undefined,
        folderId,
        tagIds: tagId ? [tagId] : undefined,
        starred: view === "starred" ? true : undefined,
      };
      const [historyResult, snippetResult, tagResult, folderResult] = await Promise.all([
        window.janusGraphDesktop.queryAssets.listHistory(historyInput),
        window.janusGraphDesktop.queryAssets.listSnippets(snippetInput),
        window.janusGraphDesktop.queryAssets.listTags(),
        window.janusGraphDesktop.queryAssets.listFolders(),
      ]);
      setHistory(historyResult.items);
      setHistoryTotal(historyResult.total);
      if (historyResult.total > 0 && historyPage * pageSize >= historyResult.total) {
        setHistoryPage(Math.max(0, Math.ceil(historyResult.total / pageSize) - 1));
      }
      setSnippets(snippetResult);
      setTags(tagResult);
      setFolders(folderResult);
      setSelected((current) => {
        if (current?.kind === "history") {
          const refreshed = historyResult.items.find((item) => item.id === current.value.id);
          return refreshed ? { kind: "history", value: refreshed } : current;
        }
        if (current?.kind === "snippet") {
          const refreshed = snippetResult.find((item) => item.id === current.value.id);
          return refreshed ? { kind: "snippet", value: refreshed } : current;
        }
        return current;
      });
    } catch (error) {
      notify({ tone: "error", message: errorMessage(error) });
    } finally {
      setLoading(false);
    }
  }, [connectionId, dateRange, folderId, historyPage, notify, search, status, tagId, view]);

  useEffect(() => { void loadAssets(); }, [loadAssets]);
  useEffect(() => { setHistoryPage(0); }, [connectionId, date, search, status, tagId, view]);
  useEffect(() => {
    if (selected?.kind === "history") setHistoryNote(selected.value.note);
    if (selected?.kind === "snippet") setSnippetDraft({
      id: selected.value.id, name: selected.value.name, description: selected.value.description,
      query: selected.value.query, bindingsText: selected.value.bindingsText,
      connectionId: selected.value.connectionId, graphName: selected.value.graphName,
      traversalSource: selected.value.traversalSource, folderId: selected.value.folderId,
      starred: selected.value.starred, tagIds: selected.value.tags.map((item) => item.id),
    });
  }, [selected]);

  const statusLabel = (value: QueryHistoryStatus) => value === "success" ? t("成功", "Success")
    : value === "error" ? t("失败", "Failed")
      : value === "cancelled" ? t("已取消", "Cancelled") : t("已截断", "Truncated");
  const showHistory = view === "all" || view === "history" || view === "starred";
  const showSnippets = view === "all" || view === "snippets" || view === "starred";
  const selectHistory = (entry: QueryHistoryAssetEntry) => { setSelected({ kind: "history", value: entry }); setHistoryNote(entry.note); };
  const selectSnippet = (snippet: QuerySnippet) => { setSelected({ kind: "snippet", value: snippet }); };
  const folderNameFor = (id: string) => folders.find((item) => item.id === id)?.name ?? t("未归类", "Unfiled");

  const saveHistory = async (entry: QueryHistoryAssetEntry, update: Partial<Pick<QueryHistoryAssetEntry, "starred" | "note">> = {}, tagIds = entry.tags.map((item) => item.id)) => {
    if (!window.janusGraphDesktop) return;
    const saved = await window.janusGraphDesktop.queryAssets.saveHistoryMetadata({
      historyId: entry.id, starred: update.starred ?? entry.starred, note: update.note ?? entry.note, tagIds,
    });
    setSelected({ kind: "history", value: { ...entry, ...saved } });
    await loadAssets();
  };
  const saveSnippet = async () => {
    if (!window.janusGraphDesktop || !snippetDraft?.name.trim() || !snippetDraft.query.trim()) return;
    try {
      const saved = await window.janusGraphDesktop.queryAssets.saveSnippet(snippetDraft);
      setSelected({ kind: "snippet", value: saved });
      notify({ tone: "success", message: t("Snippet 已保存", "Snippet saved") });
      await loadAssets();
    } catch (error) { notify({ tone: "error", message: errorMessage(error) }); }
  };
  const moveSnippetToFolder = async (snippet: QuerySnippet, nextFolderId: string) => {
    if (!window.janusGraphDesktop || snippet.folderId === nextFolderId) return;
    try {
      const saved = await window.janusGraphDesktop.queryAssets.saveSnippet({
        ...snippet,
        folderId: nextFolderId,
        tagIds: snippet.tags.map((tag) => tag.id),
      });
      setSelected({ kind: "snippet", value: saved });
      setSnippetDraft({
        id: saved.id, name: saved.name, description: saved.description,
        query: saved.query, bindingsText: saved.bindingsText, connectionId: saved.connectionId,
        graphName: saved.graphName, traversalSource: saved.traversalSource, folderId: saved.folderId,
        starred: saved.starred, tagIds: saved.tags.map((tag) => tag.id),
      });
      notify({
        tone: "success",
        message: t(`已移动到“${folderNameFor(nextFolderId)}”`, `Moved to “${folderNameFor(nextFolderId)}”`),
      });
      await loadAssets();
    } catch (error) {
      notify({ tone: "error", message: errorMessage(error) });
    } finally {
      setDraggingSnippetId("");
      setDragTargetFolderId(null);
    }
  };
  const createSnippet = (template?: BuiltInTemplate) => {
    const id = activeConnectionId;
    setSelected(null);
    setSnippetDraft({
      ...emptySnippet(id, graphNameFor(id), traversalFor(id)),
      name: template?.name ?? "", description: template?.description ?? "",
      query: template?.query ?? "", bindingsText: template?.bindingsText ?? "{}",
      folderId: folderId ?? "",
    });
  };
  const toggleSnippetTag = (id: string) => setSnippetDraft((current) => current ? ({
    ...current, tagIds: current.tagIds?.includes(id) ? current.tagIds.filter((item) => item !== id) : [...(current.tagIds ?? []), id],
  }) : current);
  const toggleHistoryTag = async (entry: QueryHistoryAssetEntry, id: string) => {
    const ids = entry.tags.map((item) => item.id);
    await saveHistory(entry, {}, ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id]);
  };
  const runBulkMetadata = async (mode: "star" | "tag") => {
    if (!window.janusGraphDesktop || selectedHistoryIds.size === 0) return;
    const selectedEntries = history.filter((item) => selectedHistoryIds.has(item.id));
    await window.janusGraphDesktop.queryAssets.saveHistoryMetadataBatch(selectedEntries.map((entry) => ({
      historyId: entry.id, starred: mode === "star" ? true : entry.starred, note: entry.note,
      tagIds: mode === "tag" && bulkTagId ? [...new Set([...entry.tags.map((item) => item.id), bulkTagId])] : entry.tags.map((item) => item.id),
    })));
    setSelectedHistoryIds(new Set());
    await loadAssets();
  };
  const removeSelectedHistory = async () => {
    if (!window.janusGraphDesktop || selectedHistoryIds.size === 0) return;
    await window.janusGraphDesktop.history.removeMany([...selectedHistoryIds]);
    setSelectedHistoryIds(new Set()); setSelected(null); await loadAssets();
  };
  const migrateLegacy = async () => {
    if (!window.janusGraphDesktop) return;
    try {
      for (const entry of legacyQueries) {
        await window.janusGraphDesktop.queryAssets.saveSnippet({
          name: entry.name, description: t("从旧版收藏迁移", "Migrated from legacy favorites"),
          query: entry.query, bindingsText: entry.bindingsText, connectionId: "", graphName: "",
          traversalSource: "", folderId: "", starred: true, tagIds: [],
        });
      }
      saveSavedQueries([]); setLegacyQueries([]); setMigrationOpen(false); await loadAssets();
      notify({ tone: "success", message: t("旧版收藏已迁移为 Snippet", "Legacy favorites migrated to Snippets") });
    } catch (error) { notify({ tone: "error", message: errorMessage(error) }); }
  };

  return (
    <div className="query-assets-page">
      <PageHeader eyebrow="QUERY ASSETS" title={t("查询资产", "Query Assets")} description={t(
        "统一管理执行历史、Snippet、文件夹和标签；历史事实保持只读，整理信息独立保存。",
        "Manage history, Snippets, folders, and tags. Execution facts remain immutable while organization metadata is stored separately.",
      )} actions={<button type="button" className="button primary" onClick={() => createSnippet()}><Plus size={17} />{t("新建 Snippet", "New Snippet")}</button>} />

      {legacyQueries.length > 0 && <section className="asset-migration-banner">
        <Archive size={20} /><div><strong>{t("发现旧版收藏", "Legacy favorites found")}</strong><small>{t(
          `${legacyQueries.length} 条 localStorage 收藏可迁移为 SQLite Snippet；迁移由你显式确认。`,
          `${legacyQueries.length} local favorites can be migrated to SQLite Snippets with your confirmation.`,
        )}</small></div><button type="button" className="button secondary" onClick={() => setMigrationOpen(true)}>{t("预览迁移", "Preview migration")}</button>
      </section>}

      <div className="query-assets-shell">
        <aside className="asset-sidebar">
          <nav aria-label={t("资产视图", "Asset views")}>
            {([
              ["all", Layers3, t("全部资产", "All assets")], ["history", History, t("执行历史", "History")],
              ["snippets", FileCode2, "Snippets"], ["starred", Star, t("已星标", "Starred")],
            ] as const).map(([id, Icon, label]) => <button type="button" key={id} className={view === id ? "is-active" : ""} onClick={() => { setView(id); setFolderId(undefined); }}><Icon size={16} /><span>{label}</span></button>)}
          </nav>
          <section>
            <header><span>{t("Snippet 文件夹", "Snippet folders")}</span><FolderPlus size={15} /></header>
            <p className="asset-sidebar-hint"><GripVertical size={13} />{t("拖动 Snippet 卡片到文件夹", "Drag Snippet cards into a folder")}</p>
            <button type="button" className={`${folderId === "" ? "is-active" : ""} ${dragTargetFolderId === "" ? "is-drop-target" : ""}`.trim()} onClick={() => { setFolderId(""); setView("snippets"); }} onDragEnter={(event) => { event.preventDefault(); setDragTargetFolderId(""); }} onDragOver={(event) => event.preventDefault()} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragTargetFolderId(null); }} onDrop={(event) => { event.preventDefault(); const id = event.dataTransfer.getData("application/x-janus-snippet"); const snippet = snippets.find((candidate) => candidate.id === id); if (snippet) void moveSnippetToFolder(snippet, ""); }}><Folder size={15} />{t("未归类", "Unfiled")}</button>
            {folders.map((item) => <div className={`asset-sidebar-row ${dragTargetFolderId === item.id ? "is-drop-target" : ""}`} key={item.id} style={{ paddingInlineStart: `${(folderDepth.get(item.id) ?? 0) * 12}px` }}><button type="button" className={folderId === item.id ? "is-active" : ""} onClick={() => { setFolderId(item.id); setView("snippets"); }} onDragEnter={(event) => { event.preventDefault(); setDragTargetFolderId(item.id); }} onDragOver={(event) => event.preventDefault()} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragTargetFolderId(null); }} onDrop={(event) => {
              event.preventDefault(); const id = event.dataTransfer.getData("application/x-janus-snippet"); const snippet = snippets.find((candidate) => candidate.id === id); if (snippet) void moveSnippetToFolder(snippet, item.id);
            }}><Folder size={15} /><span>{item.name}</span>{draggingSnippetId && <small>{t("放到这里", "Drop here")}</small>}</button><button type="button" className="asset-sidebar-edit" onClick={() => { setEditingFolder(item); setEditName(item.name); setEditParentId(item.parentId); }} aria-label={t(`编辑文件夹 ${item.name}`, `Edit folder ${item.name}`)}><Edit3 size={13} /></button></div>)}
            <form onSubmit={async (event) => { event.preventDefault(); if (!newFolderName.trim() || !window.janusGraphDesktop) return; await window.janusGraphDesktop.queryAssets.saveFolder({ name: newFolderName, parentId: folderId || "", sortOrder: folders.length }); setNewFolderName(""); await loadAssets(); }}><input value={newFolderName} onChange={(event) => setNewFolderName(event.target.value)} placeholder={t("新文件夹", "New folder")} /><button type="submit" aria-label={t("创建文件夹", "Create folder")}><Plus size={14} /></button></form>
          </section>
          <section>
            <header><span>{t("标签", "Tags")}</span><Tags size={15} /></header>
            {tags.map((item) => <div className="asset-sidebar-row" key={item.id}><button type="button" className={tagId === item.id ? "is-active" : ""} onClick={() => setTagId((current) => current === item.id ? "" : item.id)}><i style={{ background: item.color }} /><span>{item.name}</span></button><button type="button" className="asset-sidebar-edit" onClick={() => { setEditingTag(item); setEditName(item.name); setEditColor(item.color); }} aria-label={t(`编辑标签 ${item.name}`, `Edit tag ${item.name}`)}><Edit3 size={13} /></button></div>)}
            <form onSubmit={async (event) => { event.preventDefault(); if (!newTagName.trim() || !window.janusGraphDesktop) return; await window.janusGraphDesktop.queryAssets.saveTag({ name: newTagName, color: tagColors[tags.length % tagColors.length]! }); setNewTagName(""); await loadAssets(); }}><input value={newTagName} onChange={(event) => setNewTagName(event.target.value)} placeholder={t("新标签", "New tag")} /><button type="submit" aria-label={t("创建标签", "Create tag")}><Plus size={14} /></button></form>
          </section>
        </aside>

        <main className="asset-browser">
          <div className="asset-toolbar">
            <label><Search size={17} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t("搜索名称、语句、连接、图或备注", "Search names, queries, connections, graphs, or notes")} /></label>
            {showHistory && <SelectControl ariaLabel={t("连接筛选", "Connection filter")} value={connectionId} onValueChange={setConnectionId} options={[{ value: "", label: t("全部连接", "All connections") }, ...connections.map((item) => ({ value: item.id, label: item.name }))]} />}
            {showHistory && <SelectControl ariaLabel={t("状态筛选", "Status filter")} value={status} onValueChange={(value) => setStatus(value as HistoryStatusFilter)} options={[{ value: "all", label: t("全部状态", "All statuses") }, { value: "success", label: t("成功", "Success") }, { value: "error", label: t("失败", "Failed") }, { value: "cancelled", label: t("已取消", "Cancelled") }, { value: "truncated", label: t("已截断", "Truncated") }]} />}
            {showHistory && <SelectControl ariaLabel={t("日期范围", "Date range")} value={date} onValueChange={(value) => setDate(value as HistoryDateFilter)} options={[{ value: "all", label: t("全部时间", "All time") }, { value: "today", label: t("今天", "Today") }, { value: "7d", label: t("最近 7 天", "Last 7 days") }, { value: "30d", label: t("最近 30 天", "Last 30 days") }]} />}
          </div>
          {selectedHistoryIds.size > 0 && <div className="asset-bulk-bar"><strong>{t(`已选择 ${selectedHistoryIds.size} 条`, `${selectedHistoryIds.size} selected`)}</strong><button type="button" onClick={() => void runBulkMetadata("star")}><Star size={15} />{t("星标", "Star")}</button><SelectControl ariaLabel={t("批量标签", "Bulk tag")} value={bulkTagId} onValueChange={setBulkTagId} options={[{ value: "", label: t("选择标签", "Select tag") }, ...tags.map((item) => ({ value: item.id, label: item.name }))]} /><button type="button" disabled={!bulkTagId} onClick={() => void runBulkMetadata("tag")}><Tag size={15} />{t("添加标签", "Add tag")}</button><button type="button" className="is-danger" onClick={() => setDeleteHistoryOpen(true)}><Trash2 size={15} />{t("删除", "Delete")}</button><button type="button" onClick={() => setSelectedHistoryIds(new Set())}><X size={15} /></button></div>}
          <div className="asset-list" aria-busy={loading}>
            {loading && <div className="asset-loading"><LoaderCircle className="spin" size={22} />{t("加载查询资产…", "Loading query assets…")}</div>}
            {!loading && showSnippets && builtInTemplates.filter((item) => !search || `${item.name} ${item.description} ${item.query}`.toLowerCase().includes(search.toLowerCase())).map((item) => <article className="asset-row is-template" key={item.name}><span className="asset-kind"><Sparkles size={16} /></span><button type="button" onClick={() => createSnippet(item)}><strong>{item.name}</strong><code>{item.query}</code><small>{item.description}</small></button><span>{t("模板", "Template")}</span></article>)}
            {!loading && showSnippets && snippets.map((item) => <article className={`asset-row is-snippet ${selected?.kind === "snippet" && selected.value.id === item.id ? "is-selected" : ""} ${draggingSnippetId === item.id ? "is-dragging" : ""}`} key={item.id} draggable onDragStart={(event) => { setDraggingSnippetId(item.id); event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("application/x-janus-snippet", item.id); }} onDragEnd={() => { setDraggingSnippetId(""); setDragTargetFolderId(null); }}><span className="asset-drag-handle" aria-label={t("拖动到文件夹", "Drag to folder")}><GripVertical size={16} /></span><button type="button" onClick={() => selectSnippet(item)}><strong>{item.name}{item.starred && <Star size={13} fill="currentColor" />}</strong><code>{item.query}</code><small>{item.description || t("无说明", "No description")} · {item.graphName || t("未绑定图", "No graph")}</small></button><div className="asset-row-meta"><span className="asset-folder-label"><Folder size={12} />{folderNameFor(item.folderId)}</span><div className="asset-row-tags">{item.tags.map((tag) => <span key={tag.id}><i style={{ background: tag.color }} />{tag.name}</span>)}</div></div></article>)}
            {!loading && showHistory && history.map((entry) => <article className={`asset-row is-history ${selected?.kind === "history" && selected.value.id === entry.id ? "is-selected" : ""}`} key={entry.id}><input type="checkbox" checked={selectedHistoryIds.has(entry.id)} onChange={() => setSelectedHistoryIds((current) => { const next = new Set(current); if (next.has(entry.id)) next.delete(entry.id); else next.add(entry.id); return next; })} aria-label={t("选择历史记录", "Select history record")} /><button type="button" onClick={() => selectHistory(entry)}><strong><span className={`badge ${entry.status}`}>{statusLabel(entry.status)}</span>{entry.starred && <Star size={13} fill="currentColor" />}{entry.connectionName}</strong><code>{entry.query}</code><small>{formatDate(entry.createdAt, locale)} · {entry.durationMs} ms{entry.note ? ` · ${entry.note}` : ""}</small></button><div className="asset-row-tags">{entry.tags.map((tag) => <span key={tag.id}><i style={{ background: tag.color }} />{tag.name}</span>)}</div></article>)}
            {!loading && (!showHistory || history.length === 0) && (!showSnippets || (snippets.length === 0 && builtInTemplates.filter((item) => !search || `${item.name} ${item.description} ${item.query}`.toLowerCase().includes(search.toLowerCase())).length === 0)) && <EmptyState icon={<Clock3 size={30} />} title={t("没有匹配的查询资产", "No matching query assets")} description={t("修改搜索或筛选条件。", "Change the search or filters.")} />}
          </div>
          {showHistory && historyTotal > pageSize && <footer className="asset-pagination"><span>{historyPage * pageSize + 1}–{Math.min((historyPage + 1) * pageSize, historyTotal)} / {historyTotal}</span><button type="button" disabled={historyPage === 0} onClick={() => setHistoryPage((value) => value - 1)}><ChevronLeft size={16} /></button><button type="button" disabled={(historyPage + 1) * pageSize >= historyTotal} onClick={() => setHistoryPage((value) => value + 1)}><ChevronRight size={16} /></button></footer>}
        </main>

        <aside className="asset-inspector">
          {selected?.kind === "history" ? <>
            <header><span className="eyebrow">EXECUTION FACT</span><strong>{t("历史详情", "History detail")}</strong><button type="button" onClick={() => void saveHistory(selected.value, { starred: !selected.value.starred })} aria-label={t("切换星标", "Toggle star")}><Star size={17} fill={selected.value.starred ? "currentColor" : "none"} /></button></header>
            <div className="asset-fact-grid"><span><small>{t("连接", "Connection")}</small><strong>{selected.value.connectionName}</strong></span><span><small>{t("图", "Graph")}</small><strong>{selected.value.graphName || "—"}</strong></span><span><small>Traversal Source</small><strong>{selected.value.traversalSource || "—"}</strong></span><span><small>{t("状态", "Status")}</small><strong>{statusLabel(selected.value.status)}</strong></span><span><small>{t("耗时", "Duration")}</small><strong>{selected.value.durationMs} ms</strong></span><span><small>{t("结果", "Results")}</small><strong>{selected.value.resultCount}</strong></span></div>
            <label><span>{t("Gremlin 语句", "Gremlin query")}</span><textarea value={selected.value.query} readOnly /></label>
            <label><span>{t("备注", "Note")}</span><textarea value={historyNote} onChange={(event) => setHistoryNote(event.target.value)} placeholder={t("记录用途、结论或排查线索", "Record purpose, conclusion, or investigation notes")} /></label>
            <div className="asset-tag-picker"><header><strong>{t("选择标签", "Choose tags")}</strong><small>{t("高亮并带勾的标签已关联", "Highlighted tags with a check are assigned")}</small></header>{tags.map((tag) => { const active = selected.value.tags.some((item) => item.id === tag.id); return <button type="button" key={tag.id} className={active ? "is-active" : ""} onClick={() => void toggleHistoryTag(selected.value, tag.id)}><i style={{ background: tag.color }} />{tag.name}{active && <Check size={13} />}</button>; })}</div>
            <footer><button type="button" className="button secondary" onClick={() => void saveHistory(selected.value, { note: historyNote })}><Check size={16} />{t("保存整理信息", "Save metadata")}</button><button type="button" className="button primary" onClick={() => onOpenHistory(selected.value)}><Code2 size={16} />{t("在新标签页打开", "Open in new tab")}</button></footer>
          </> : snippetDraft ? <>
            <header><span className="eyebrow">REUSABLE QUERY</span><strong>{snippetDraft.id ? t("编辑 Snippet", "Edit Snippet") : t("新建 Snippet", "New Snippet")}</strong><button type="button" onClick={() => setSnippetDraft((current) => current ? { ...current, starred: !current.starred } : current)}><Star size={17} fill={snippetDraft.starred ? "currentColor" : "none"} /></button></header>
            <label><span>{t("名称", "Name")}</span><input value={snippetDraft.name} onChange={(event) => setSnippetDraft({ ...snippetDraft, name: event.target.value })} /></label>
            <label><span>{t("说明", "Description")}</span><input value={snippetDraft.description} onChange={(event) => setSnippetDraft({ ...snippetDraft, description: event.target.value })} /></label>
            <label><span>Gremlin</span><textarea className="is-code" value={snippetDraft.query} onChange={(event) => setSnippetDraft({ ...snippetDraft, query: event.target.value })} /></label>
            <label><span>{t("参数 JSON", "Bindings JSON")}</span><textarea className="is-code is-bindings" value={snippetDraft.bindingsText} onChange={(event) => setSnippetDraft({ ...snippetDraft, bindingsText: event.target.value })} /></label>
            <div className="asset-context-grid"><label><span>{t("连接", "Connection")}</span><SelectControl ariaLabel={t("Snippet 连接", "Snippet connection")} value={snippetDraft.connectionId} onValueChange={(id) => setSnippetDraft({ ...snippetDraft, connectionId: id, graphName: graphNameFor(id), traversalSource: traversalFor(id) })} options={[{ value: "", label: t("不绑定连接", "No connection") }, ...connections.map((item) => ({ value: item.id, label: item.name }))]} /></label><label><span>{t("图名称", "Graph name")}</span><input value={snippetDraft.graphName} onChange={(event) => setSnippetDraft({ ...snippetDraft, graphName: event.target.value })} /></label><label><span>Traversal Source</span><input value={snippetDraft.traversalSource} onChange={(event) => setSnippetDraft({ ...snippetDraft, traversalSource: event.target.value })} /></label><label className={`asset-folder-field ${snippetDraft.id && selected?.kind === "snippet" && selected.value.folderId !== snippetDraft.folderId ? "has-pending-change" : ""}`.trim()}><span>{t("Snippet 文件夹", "Snippet folder")}</span><SelectControl ariaLabel={t("Snippet 文件夹", "Snippet folder")} value={snippetDraft.folderId} onValueChange={(id) => setSnippetDraft({ ...snippetDraft, folderId: id })} options={[{ value: "", label: t("未归类", "Unfiled") }, ...folders.map((item) => ({ value: item.id, label: item.name }))]} /><small>{snippetDraft.id && selected?.kind === "snippet" && selected.value.folderId !== snippetDraft.folderId ? t("文件夹已更改，保存 Snippet 后生效", "Folder changed; save the Snippet to apply") : t("文件夹随 Snippet 一起保存", "The folder is saved with the Snippet")}</small></label></div>
            <div className="asset-tag-picker"><header><strong>{t("选择标签", "Choose tags")}</strong><small>{t("高亮并带勾的标签已关联", "Highlighted tags with a check are assigned")}</small></header>{tags.map((tag) => { const active = snippetDraft.tagIds?.includes(tag.id); return <button type="button" key={tag.id} className={active ? "is-active" : ""} onClick={() => toggleSnippetTag(tag.id)}><i style={{ background: tag.color }} />{tag.name}{active && <Check size={13} />}</button>; })}</div>
            <footer className="asset-inspector-actions">{snippetDraft.id && <button type="button" className="button danger ghost" onClick={() => setDeleteSnippet(selected?.kind === "snippet" ? selected.value : null)} title={t("删除 Snippet", "Delete Snippet")}><Trash2 size={16} />{t("删除", "Delete")}</button>}<button type="button" className="button secondary" disabled={!snippetDraft.id || !connections.some((item) => item.id === snippetDraft.connectionId) && Boolean(snippetDraft.connectionId)} onClick={() => selected?.kind === "snippet" && onOpenSnippet({ ...selected.value, ...snippetDraft, tags: tags.filter((tag) => snippetDraft.tagIds?.includes(tag.id)), createdAt: selected.value.createdAt, updatedAt: selected.value.updatedAt })} title={t("在新标签页打开", "Open in new tab")}><Code2 size={16} />{t("打开", "Open")}</button><button type="button" className="button primary" disabled={!snippetDraft.name.trim() || !snippetDraft.query.trim()} onClick={() => void saveSnippet()} title={t("保存 Snippet", "Save Snippet")}><Check size={16} />{t("保存", "Save")}</button></footer>
          </> : <EmptyState icon={<Edit3 size={30} />} title={t("选择一个查询资产", "Select a query asset")} description={t("查看历史详情，或编辑可复用的 Snippet。", "Inspect history details or edit a reusable Snippet.")} />}
        </aside>
      </div>

      {migrationOpen && <Modal eyebrow="LEGACY FAVORITES" title={t("迁移旧版收藏", "Migrate Legacy Favorites")} width="wide" onClose={() => setMigrationOpen(false)}><div className="asset-migration-dialog"><p>{t("以下收藏将新增为 Snippet；不会覆盖现有资产。迁移成功后才会清理旧存储。", "These favorites will be added as Snippets without overwriting existing assets. Legacy storage is cleared only after success.")}</p><div>{legacyQueries.map((item) => <article key={item.id}><Star size={15} /><strong>{item.name}</strong><code>{item.query}</code></article>)}</div><footer className="modal-actions"><button type="button" className="button secondary" onClick={() => setMigrationOpen(false)}>{t("取消", "Cancel")}</button><button type="button" className="button primary" onClick={() => void migrateLegacy()}><Archive size={16} />{t(`迁移 ${legacyQueries.length} 条`, `Migrate ${legacyQueries.length}`)}</button></footer></div></Modal>}
      {deleteSnippet && <Modal eyebrow="CONFIRM ACTION" title={t("删除 Snippet", "Delete Snippet")} width="narrow" onClose={() => setDeleteSnippet(null)}><div className="confirm-content danger"><Trash2 size={26} /><p>{t(`将删除“${deleteSnippet.name}”。此操作不会删除执行历史。`, `Delete “${deleteSnippet.name}”. Query history is not affected.`)}</p></div><footer className="modal-actions"><button type="button" className="button secondary" onClick={() => setDeleteSnippet(null)}>{t("取消", "Cancel")}</button><button type="button" className="button danger" onClick={async () => { await window.janusGraphDesktop?.queryAssets.removeSnippet(deleteSnippet.id); setDeleteSnippet(null); setSelected(null); setSnippetDraft(null); await loadAssets(); }}><Trash2 size={16} />{t("删除", "Delete")}</button></footer></Modal>}
      {deleteHistoryOpen && <Modal eyebrow="CONFIRM ACTION" title={t("删除执行历史", "Delete query history")} width="narrow" onClose={() => setDeleteHistoryOpen(false)}><div className="confirm-content danger"><Trash2 size={26} /><p>{t(`将永久删除 ${selectedHistoryIds.size} 条执行历史；关联的备注和标签也会一并删除。`, `Permanently delete ${selectedHistoryIds.size} history entries and their notes and tags.`)}</p></div><footer className="modal-actions"><button type="button" className="button secondary" onClick={() => setDeleteHistoryOpen(false)}>{t("取消", "Cancel")}</button><button type="button" className="button danger" onClick={() => { setDeleteHistoryOpen(false); void removeSelectedHistory(); }}><Trash2 size={16} />{t("删除历史", "Delete history")}</button></footer></Modal>}
      {editingFolder && <Modal eyebrow="ORGANIZE ASSETS" title={t("编辑文件夹", "Edit Folder")} width="narrow" onClose={() => setEditingFolder(null)}><div className="asset-edit-dialog"><label><span>{t("名称", "Name")}</span><input value={editName} onChange={(event) => setEditName(event.target.value)} /></label><label><span>{t("上级文件夹", "Parent folder")}</span><SelectControl ariaLabel={t("上级文件夹", "Parent folder")} value={editParentId} onValueChange={setEditParentId} options={[{ value: "", label: t("无上级", "No parent") }, ...folders.filter((item) => item.id !== editingFolder.id).map((item) => ({ value: item.id, label: item.name }))]} /></label><p>{t("删除文件夹不会删除其中的 Snippet；资产会移到“未归类”。", "Deleting a folder does not delete its Snippets; assets become unfiled.")}</p></div><footer className="modal-actions split"><button type="button" className="button danger ghost" onClick={async () => { await window.janusGraphDesktop?.queryAssets.removeFolder(editingFolder.id); if (folderId === editingFolder.id) setFolderId(undefined); setEditingFolder(null); await loadAssets(); }}><Trash2 size={16} />{t("删除文件夹", "Delete folder")}</button><span /><button type="button" className="button secondary" onClick={() => setEditingFolder(null)}>{t("取消", "Cancel")}</button><button type="button" className="button primary" disabled={!editName.trim()} onClick={async () => { await window.janusGraphDesktop?.queryAssets.saveFolder({ id: editingFolder.id, name: editName, parentId: editParentId, sortOrder: editingFolder.sortOrder }); setEditingFolder(null); await loadAssets(); }}><Check size={16} />{t("保存", "Save")}</button></footer></Modal>}
      {editingTag && <Modal eyebrow="ORGANIZE ASSETS" title={t("编辑标签", "Edit Tag")} width="narrow" onClose={() => setEditingTag(null)}><div className="asset-edit-dialog"><label><span>{t("名称", "Name")}</span><input value={editName} onChange={(event) => setEditName(event.target.value)} /></label><label><span>{t("颜色", "Color")}</span><div className="asset-color-picker">{tagColors.map((color) => <button key={color} type="button" className={editColor === color ? "is-active" : ""} style={{ background: color }} onClick={() => setEditColor(color)} aria-label={color} />)}</div></label><p>{t("删除标签只会解除资产关联，不会删除历史或 Snippet。", "Deleting a tag only removes associations; history and Snippets remain.")}</p></div><footer className="modal-actions split"><button type="button" className="button danger ghost" onClick={async () => { await window.janusGraphDesktop?.queryAssets.removeTag(editingTag.id); if (tagId === editingTag.id) setTagId(""); setEditingTag(null); await loadAssets(); }}><Trash2 size={16} />{t("删除标签", "Delete tag")}</button><span /><button type="button" className="button secondary" onClick={() => setEditingTag(null)}>{t("取消", "Cancel")}</button><button type="button" className="button primary" disabled={!editName.trim()} onClick={async () => { await window.janusGraphDesktop?.queryAssets.saveTag({ id: editingTag.id, name: editName, color: editColor }); setEditingTag(null); await loadAssets(); }}><Check size={16} />{t("保存", "Save")}</button></footer></Modal>}
    </div>
  );
}
