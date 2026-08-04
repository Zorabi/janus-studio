import type { QueryExecutionResult } from "@janusgraph/domain";
import type { AppSettings } from "../../lib/settings";
import type {
  GraphEdgeModel,
  GraphNodeModel,
} from "../../lib/result-model";

export type ResultMode = "graph" | "table" | "json" | "raw" | "source";

export type Selection =
  | { kind: "node"; value: GraphNodeModel }
  | { kind: "edge"; value: GraphEdgeModel }
  | null;

export type SelectionDetailState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string };

export type QueryState =
  | { status: "idle" }
  | { status: "loading"; executionId?: string; stopping?: boolean }
  | { status: "cancelled"; message: string }
  | { status: "error"; message: string }
  | { status: "success"; result: QueryExecutionResult };

export type QueryTabState = {
  id: string;
  title: string;
  connectionId: string;
  query: string;
  queryState: QueryState;
  mode: ResultMode;
  selection: Selection;
  bindingsText: string;
  bindingsEnabled: boolean;
  readOnly: boolean;
  scriptName: string;
  savedContent: string;
};

export type SavedQuery = {
  id: string;
  name: string;
  query: string;
  bindingsText: string;
  createdAt: string;
};

export type ToastState = {
  tone: "success" | "error" | "info";
  message: string;
};

const QUERY_WORKSPACE_STORAGE_KEY = "janusgraph.queryWorkspace.v3";
const PREVIOUS_QUERY_WORKSPACE_STORAGE_KEY = "janusgraph.queryWorkspace.v2";
const LEGACY_QUERY_WORKSPACE_STORAGE_KEY = "janusgraph.queryWorkspace.v1";
const SAVED_QUERIES_STORAGE_KEY = "janusgraph.savedQueries.v1";

type PersistedQueryWorkspace = {
  activeTabId: string;
  sequence: number;
  tabs: Array<
    Pick<
      QueryTabState,
      | "id"
      | "title"
      | "connectionId"
      | "query"
      | "mode"
      | "bindingsText"
      | "bindingsEnabled"
      | "readOnly"
      | "scriptName"
      | "savedContent"
    >
  >;
};

export function createQueryTab(
  sequence: number,
  defaultMode: AppSettings["defaultResultMode"],
  connectionId: string,
  query = "",
): QueryTabState {
  return {
    id: crypto.randomUUID(),
    title: `Query ${sequence}`,
    connectionId,
    query,
    queryState: { status: "idle" },
    mode: defaultMode === "auto" ? "table" : defaultMode,
    selection: null,
    bindingsText: "{}",
    bindingsEnabled: false,
    readOnly: false,
    scriptName: "",
    savedContent: "",
  };
}

export function loadQueryWorkspace(
  defaultMode: AppSettings["defaultResultMode"],
  fallbackConnectionId: string,
): { tabs: QueryTabState[]; activeTabId: string; sequence: number } {
  const fallback = createQueryTab(1, defaultMode, fallbackConnectionId);
  try {
    const stored = JSON.parse(
      localStorage.getItem(QUERY_WORKSPACE_STORAGE_KEY) ??
        localStorage.getItem(PREVIOUS_QUERY_WORKSPACE_STORAGE_KEY) ??
        localStorage.getItem(LEGACY_QUERY_WORKSPACE_STORAGE_KEY) ??
        "null",
    ) as Partial<PersistedQueryWorkspace> | null;
    if (!stored || !Array.isArray(stored.tabs)) {
      return { tabs: [fallback], activeTabId: fallback.id, sequence: 1 };
    }

    const usedIds = new Set<string>();
    const tabs = stored.tabs.slice(0, 50).flatMap((candidate) => {
      if (!candidate || typeof candidate !== "object") return [];
      const id =
        typeof candidate.id === "string" && candidate.id && !usedIds.has(candidate.id)
          ? candidate.id
          : crypto.randomUUID();
      usedIds.add(id);
      const mode: ResultMode = ["graph", "table", "json", "raw", "source"].includes(candidate.mode)
        ? candidate.mode
        : defaultMode === "auto"
          ? "table"
          : defaultMode;
      return [{
        id,
        title:
          typeof candidate.title === "string" && candidate.title.trim()
            ? candidate.title.slice(0, 80)
            : `Query ${usedIds.size}`,
        connectionId:
          typeof candidate.connectionId === "string"
            ? candidate.connectionId
            : fallbackConnectionId,
        query: typeof candidate.query === "string" ? candidate.query.slice(0, 1_000_000) : "",
        mode,
        queryState: { status: "idle" } as QueryState,
        selection: null,
        bindingsText:
          typeof candidate.bindingsText === "string"
            ? candidate.bindingsText.slice(0, 1_000_000)
            : "{}",
        bindingsEnabled: candidate.bindingsEnabled === true,
        readOnly: candidate.readOnly === true,
        scriptName:
          typeof candidate.scriptName === "string"
            ? candidate.scriptName.slice(0, 255)
            : "",
        savedContent:
          typeof candidate.savedContent === "string"
            ? candidate.savedContent.slice(0, 1_000_000)
            : "",
      }];
    });
    if (tabs.length === 0) {
      return { tabs: [fallback], activeTabId: fallback.id, sequence: 1 };
    }

    const titleSequence = tabs.reduce((maximum, tab) => {
      const match = /^Query\s+(\d+)$/i.exec(tab.title);
      return Math.max(maximum, Number(match?.[1] ?? 0));
    }, tabs.length);
    const sequence = Math.max(
      titleSequence,
      Number.isFinite(stored.sequence) ? Number(stored.sequence) : 0,
    );
    const activeTabId = tabs.some((tab) => tab.id === stored.activeTabId)
      ? stored.activeTabId!
      : tabs[0]!.id;
    return { tabs, activeTabId, sequence };
  } catch {
    return { tabs: [fallback], activeTabId: fallback.id, sequence: 1 };
  }
}

export function saveQueryWorkspace(
  tabs: QueryTabState[],
  activeTabId: string,
  sequence: number,
): void {
  const workspace: PersistedQueryWorkspace = {
    activeTabId,
    sequence,
    tabs: tabs.map(({
      id,
      title,
      connectionId,
      query,
      mode,
      bindingsText,
      bindingsEnabled,
      readOnly,
      scriptName,
      savedContent,
    }) => ({
      id,
      title,
      connectionId,
      query,
      mode,
      bindingsText,
      bindingsEnabled,
      readOnly,
      scriptName,
      savedContent,
    })),
  };
  localStorage.setItem(QUERY_WORKSPACE_STORAGE_KEY, JSON.stringify(workspace));
}

export function loadSavedQueries(): SavedQuery[] {
  try {
    const value = JSON.parse(localStorage.getItem(SAVED_QUERIES_STORAGE_KEY) ?? "[]") as unknown;
    if (!Array.isArray(value)) return [];
    return value.slice(0, 200).flatMap((candidate) => {
      if (!candidate || typeof candidate !== "object") return [];
      const entry = candidate as Partial<SavedQuery>;
      if (typeof entry.id !== "string" || typeof entry.query !== "string") return [];
      return [{
        id: entry.id,
        name: typeof entry.name === "string" ? entry.name : entry.query.slice(0, 48),
        query: entry.query,
        bindingsText: typeof entry.bindingsText === "string" ? entry.bindingsText : "{}",
        createdAt: typeof entry.createdAt === "string" ? entry.createdAt : new Date().toISOString(),
      }];
    });
  } catch {
    return [];
  }
}

export function saveSavedQueries(entries: SavedQuery[]): void {
  localStorage.setItem(SAVED_QUERIES_STORAGE_KEY, JSON.stringify(entries.slice(0, 200)));
}
