import { connectionEndpoint } from "@janusgraph/application";
import type { ConnectionSummary, ConnectionTestReport, DiagnosticIncidentContext, QueryExecutionResult, QueryHistoryAssetEntry, QueryHistoryEntry, QuerySnippet, SaveConnectionInput } from "@janusgraph/domain";
import {
  Activity,
  AlertTriangle,
  Boxes,
  CheckCircle2,
  Database,
  FileUp,
  GitBranch,
  History,
  Layers3,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Settings2,
  ScanSearch,
  Stethoscope,
  TerminalSquare,
  Waypoints,
  X,
} from "lucide-react";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { SelectControl } from "./components/SelectControl";
import { TaskCenterHost } from "./components/tasks/TaskCenterHost";
import { useBackgroundTasks } from "./components/tasks/useBackgroundTasks";
import { ConfirmDialog, IconButton } from "./components/ui";
import { ConnectionDialog } from "./features/connections/ConnectionDialog";
import { ConnectionsPage } from "./features/connections/ConnectionsPage";
import { DiagnosticsPage } from "./features/diagnostics/DiagnosticsPage";
import { GraphFactoryPage } from "./features/graph-factory/GraphFactoryPage";
import { HistoryPage } from "./features/history/HistoryPage";
import { QueryPage } from "./features/query/QueryPage";
import {
  isMutationQuery,
  traversalAnalysisKind,
} from "./features/query/query-utils";
import {
  createFreshQueryWorkspace,
  createGraphQueryTab,
  createQueryTab,
  loadQueryWorkspace,
  nextAvailableQuerySequence,
  saveQueryWorkspace,
  type QueryState,
  type QueryTabState,
  type ToastState,
} from "./features/query/query-workspace";
import { SchemaPage } from "./features/schema/SchemaPage";
import { SettingsPage } from "./features/settings/SettingsPage";
import { TransferPage } from "./features/transfer/TransferPage";
import { QualityPage } from "./features/quality/QualityPage";
import { LocaleProvider, translate } from "./lib/i18n";
import {
  connectionWithGraphContext,
  dynamicGraphContext,
  graphContextForConnection,
  type DynamicGraphContext,
  type DynamicGraphTarget,
} from "./lib/dynamic-graph-context";
import { matchesShortcut, shortcutLabel } from "./lib/keyboard";
import { errorMessage } from "./lib/presentation";
import { buildGraphModel } from "./lib/result-model";
import { applySettings, loadSettings, saveSettings, type AppSettings } from "./lib/settings";
type ViewId = "query" | "connections" | "history" | "graphFactory" | "schema" | "quality" | "transfer" | "diagnostics" | "settings";
const NAV_ITEMS: Array<{
  id: ViewId;
  label: string;
  description: string;
  icon: ReactNode;
  primary?: boolean;
}> = [
  { id: "query", label: "查询工作台", description: "执行 Gremlin 并查看结果", icon: <TerminalSquare size={19} /> },
  {
    id: "connections",
    label: "连接管理",
    description: "账号、协议与认证",
    icon: <Database size={19} />,
  },
  {
    id: "history",
    label: "查询资产",
    description: "历史、Snippet 与标签",
    icon: <History size={19} />,
  },
  {
    id: "graphFactory",
    label: "动态图",
    description: "ConfiguredGraphFactory 管理",
    icon: <Boxes size={19} />,
  },
  {
    id: "schema",
    label: "Schema",
    description: "类型与索引管理",
    icon: <Layers3 size={19} />,
  },
  {
    id: "transfer",
    label: "导入导出",
    description: "整图归档与结果导出",
    icon: <FileUp size={19} />,
  },
  { id: "quality", label: "数据质量", description: "只读规则与质量审计", icon: <ScanSearch size={19} /> },
  {
    id: "diagnostics",
    label: "问题诊断",
    description: "生成脱敏诊断包",
    icon: <Stethoscope size={19} />,
    primary: false,
  },
  {
    id: "settings",
    label: "偏好设置",
    description: "阅读与交互",
    icon: <Settings2 size={19} />,
  },
];

export default function App() {
  const [view, setView] = useState<ViewId>("query");
  const [qualityRunRequest, setQualityRunRequest] = useState<{ id: string; nonce: number }>();
  const [diagnosticIncident, setDiagnosticIncident] = useState<DiagnosticIncidentContext>();
  const [settings, setSettings] = useState<AppSettings>(loadSettings);
  const [connections, setConnections] = useState<ConnectionSummary[]>([]);
  const [activeConnectionId, setActiveConnectionId] = useState(
    () => localStorage.getItem("janusgraph.activeConnection") ?? "",
  );
  const [connectionDialog, setConnectionDialog] = useState<{
    editing: ConnectionSummary | null;
  } | null>(null);
  const [deleteConnection, setDeleteConnection] =
    useState<ConnectionSummary | null>(null);
  const [history, setHistory] = useState<QueryHistoryEntry[]>([]);
  const [pendingProductionQuery, setPendingProductionQuery] = useState<{
    tabId: string;
    queryOverride?: string;
    bindings: Record<string, unknown>;
  } | null>(null);
  const [schemaGraphContext, setSchemaGraphContext] = useState<DynamicGraphContext | null>(null);
  const [initialQueryWorkspace] = useState(() =>
    loadQueryWorkspace(settings.defaultResultMode, activeConnectionId),
  );
  const queryTabSequence = useRef(initialQueryWorkspace.sequence);
  const closedQueryTabs = useRef<QueryTabState[]>([]);
  const [closedQueryTabCount, setClosedQueryTabCount] = useState(0);
  const [queryTabs, setQueryTabs] = useState<QueryTabState[]>(
    initialQueryWorkspace.tabs,
  );
  const [activeQueryTabId, setActiveQueryTabId] = useState(
    initialQueryWorkspace.activeTabId,
  );
  const [toast, setToast] = useState<ToastState | null>(null);
  const notify = useCallback((next: ToastState) => setToast(next), []);
  const tx = useCallback(
    (chinese: string, english?: string) =>
      translate(settings.locale, chinese, english),
    [settings.locale],
  );
  const activeConnection = connections.find(
    (connection) => connection.id === activeConnectionId,
  );
  const activeQueryTab =
    queryTabs.find((tab) => tab.id === activeQueryTabId) ?? queryTabs[0]!;
  const queryConnection = connections.find(
    (connection) => connection.id === activeQueryTab.connectionId,
  );
  const queryExecutionConnection = queryConnection
    ? {
        ...queryConnection,
        traversalSource:
          activeQueryTab.traversalSourceOverride || queryConnection.traversalSource,
        graphBinding:
          activeQueryTab.graphBindingOverride || queryConnection.graphBinding,
      }
    : undefined;
  const activeSchemaGraphContext = graphContextForConnection(schemaGraphContext, activeConnectionId);
  const schemaConnection = connectionWithGraphContext(activeConnection, activeSchemaGraphContext);

  const updateQueryTab = useCallback(
    (id: string, update: Partial<QueryTabState>) =>
      setQueryTabs((current) =>
        current.map((tab) => (tab.id === id ? { ...tab, ...update } : tab)),
      ),
    [],
  );

  const addQueryTab = useCallback(
    (initialQuery = "") => {
      queryTabSequence.current = nextAvailableQuerySequence(
        queryTabs,
        queryTabSequence.current,
      );
      const tab = createQueryTab(
        queryTabSequence.current,
        settings.defaultResultMode,
        activeQueryTab.connectionId || activeConnectionId,
        initialQuery,
      );
      setQueryTabs((current) => [...current, tab]);
      setActiveQueryTabId(tab.id);
      setView("query");
    },
    [
      activeConnectionId,
      activeQueryTab.connectionId,
      queryTabs,
      settings.defaultResultMode,
    ],
  );

  const openGraphQueryContext = useCallback((graph: DynamicGraphTarget, connectionId = activeConnectionId) => {
    queryTabSequence.current = nextAvailableQuerySequence(queryTabs, queryTabSequence.current);
    const tab = createGraphQueryTab(
      queryTabSequence.current,
      settings.defaultResultMode,
      connectionId,
      graph,
    );
    setQueryTabs((current) => [...current, tab]);
    setActiveQueryTabId(tab.id);
    setView("query");
    setToast({
      tone: "success",
      message: tx(
        `已创建“${graph.name}”查询上下文`,
        `Created a query context for “${graph.name}”`,
      ),
    });
  }, [activeConnectionId, queryTabs, settings.defaultResultMode, tx]);

  const openQueryAsset = useCallback((asset: QueryHistoryAssetEntry | QuerySnippet, kind: "history" | "snippet") => {
    queryTabSequence.current = nextAvailableQuerySequence(queryTabs, queryTabSequence.current);
    const connectionExists = connections.some((connection) => connection.id === asset.connectionId);
    const connectionId = connectionExists ? asset.connectionId : activeConnectionId;
    const tab = createQueryTab(queryTabSequence.current, settings.defaultResultMode, connectionId, asset.query);
    if (kind === "snippet") {
      const snippet = asset as QuerySnippet;
      tab.title = snippet.name;
      tab.bindingsText = snippet.bindingsText;
      try {
        const parsed = JSON.parse(snippet.bindingsText) as Record<string, unknown>;
        tab.bindingsEnabled = Object.keys(parsed).length > 0;
      } catch { tab.bindingsEnabled = false; }
      if (connectionExists && snippet.graphName) tab.graphBindingOverride = snippet.graphName;
      if (connectionExists && snippet.traversalSource) tab.traversalSourceOverride = snippet.traversalSource;
    } else {
      tab.title = tx("历史查询", "History query");
      const historyEntry = asset as QueryHistoryAssetEntry;
      if (connectionExists && historyEntry.graphName) tab.graphBindingOverride = historyEntry.graphName;
      if (connectionExists && historyEntry.traversalSource) tab.traversalSourceOverride = historyEntry.traversalSource;
    }
    setQueryTabs((current) => [...current, tab]);
    setActiveQueryTabId(tab.id);
    if (connectionId) {
      setActiveConnectionId(connectionId);
      localStorage.setItem("janusgraph.activeConnection", connectionId);
    }
    setView("query");
    notify({ tone: "info", message: connectionExists || !asset.connectionId
      ? tx("查询资产已在新标签页打开", "Query asset opened in a new tab")
      : tx("原连接已不存在，已使用当前连接；请核对图上下文", "The original connection no longer exists. The current connection is used; verify the graph context") });
  }, [activeConnectionId, connections, notify, queryTabs, settings.defaultResultMode, tx]);

  const rememberClosedQueryTabs = useCallback((tabs: QueryTabState[]) => {
    if (tabs.length === 0) return;
    closedQueryTabs.current = [
      ...tabs.map((tab) => ({
        ...tab,
        queryState: { status: "idle" } as QueryState,
        selection: null,
      })),
      ...closedQueryTabs.current,
    ].slice(0, 20);
    setClosedQueryTabCount(closedQueryTabs.current.length);
  }, []);

  const duplicateQueryTab = useCallback((id: string) => {
    const source = queryTabs.find((tab) => tab.id === id);
    if (!source) return;
    const tab: QueryTabState = {
      ...source,
      id: crypto.randomUUID(),
      title: tx(`${source.title} 副本`, `${source.title} copy`),
      queryState: { status: "idle" },
      selection: null,
      scriptName: "",
      savedContent: "",
    };
    setQueryTabs((current) => {
      const index = current.findIndex((candidate) => candidate.id === id);
      const next = [...current];
      next.splice(index + 1, 0, tab);
      return next;
    });
    setActiveQueryTabId(tab.id);
    setView("query");
  }, [queryTabs, tx]);

  const renameQueryTab = useCallback((id: string, title: string) => {
    updateQueryTab(id, { title: title.trim().slice(0, 80) });
  }, [updateQueryTab]);

  const restoreClosedQueryTab = useCallback(() => {
    const [closed, ...remaining] = closedQueryTabs.current;
    if (!closed) return;
    closedQueryTabs.current = remaining;
    setClosedQueryTabCount(remaining.length);
    const restored: QueryTabState = {
      ...closed,
      id: crypto.randomUUID(),
      queryState: { status: "idle" },
      selection: null,
    };
    setQueryTabs((current) => [...current, restored]);
    setActiveQueryTabId(restored.id);
    setView("query");
  }, []);

  const closeQueryTab = useCallback(
    (id: string) => {
      const closing = queryTabs.find((tab) => tab.id === id);
      if (closing) rememberClosedQueryTabs([closing]);
      if (closing?.connectionId) {
        void window.janusGraphDesktop?.queries.closeConsole({
          connectionId: closing.connectionId,
          consoleId: closing.id,
        });
      }
      if (queryTabs.length === 1) {
        const replacement = createFreshQueryWorkspace(
          settings.defaultResultMode,
          closing?.connectionId || activeConnectionId,
        );
        queryTabSequence.current = replacement.sequence;
        setQueryTabs(replacement.tabs);
        setActiveQueryTabId(replacement.activeTabId);
        return;
      }
      const index = queryTabs.findIndex((tab) => tab.id === id);
      const next = queryTabs.filter((tab) => tab.id !== id);
      setQueryTabs(next);
      if (activeQueryTabId === id) {
        setActiveQueryTabId(
          next[Math.min(Math.max(index, 0), next.length - 1)]!.id,
        );
      }
    },
    [activeConnectionId, activeQueryTabId, queryTabs, rememberClosedQueryTabs, settings.defaultResultMode],
  );

  const closeOtherQueryTabs = useCallback((id: string) => {
    const keep = queryTabs.find((tab) => tab.id === id);
    if (!keep) return;
    const closing = queryTabs.filter((tab) => tab.id !== id);
    rememberClosedQueryTabs(closing);
    closing.forEach((tab) => {
      if (!tab.connectionId) return;
      void window.janusGraphDesktop?.queries.closeConsole({
        connectionId: tab.connectionId,
        consoleId: tab.id,
      });
    });
    setQueryTabs([keep]);
    setActiveQueryTabId(keep.id);
  }, [queryTabs, rememberClosedQueryTabs]);

  const closeQueryTabsToRight = useCallback((id: string) => {
    const index = queryTabs.findIndex((tab) => tab.id === id);
    if (index < 0 || index === queryTabs.length - 1) return;
    const keep = queryTabs.slice(0, index + 1);
    const closing = queryTabs.slice(index + 1);
    rememberClosedQueryTabs(closing);
    closing.forEach((tab) => {
      if (!tab.connectionId) return;
      void window.janusGraphDesktop?.queries.closeConsole({
        connectionId: tab.connectionId,
        consoleId: tab.id,
      });
    });
    setQueryTabs(keep);
    if (closing.some((tab) => tab.id === activeQueryTabId)) {
      setActiveQueryTabId(id);
    }
  }, [activeQueryTabId, queryTabs, rememberClosedQueryTabs]);

  const backgroundTaskCenter = useBackgroundTasks({
    translate: tx,
    notify,
    navigate: (task) => {
      if (task.connectionId) { setActiveConnectionId(task.connectionId); localStorage.setItem("janusgraph.activeConnection", task.connectionId); }
      if (task.kind === "quality") setQualityRunRequest({ id: task.id, nonce: Date.now() });
      setView(task.kind === "schema" ? "schema" : task.kind === "maintenance" ? "graphFactory" : task.kind === "quality" ? "quality" : "transfer");
    },
    navigateToDiagnostics: (incident) => { setDiagnosticIncident(incident); setView("diagnostics"); },
  });

  const loadConnections = useCallback(async () => {
    if (!window.janusGraphDesktop) return;
    const loaded = await window.janusGraphDesktop.connections.list();
    setConnections(loaded);
    const validIds = new Set(loaded.map((connection) => connection.id));
    const fallbackId = loaded[0]?.id ?? "";
    setQueryTabs((current) =>
      current.map((tab) =>
        validIds.has(tab.connectionId)
          ? tab
          : {
              ...tab,
              connectionId: fallbackId,
              traversalSourceOverride: "",
              graphBindingOverride: "",
            },
      ),
    );
    setActiveConnectionId((current) => {
      const next = loaded.some((connection) => connection.id === current)
        ? current
        : loaded[0]?.id ?? "";
      if (next) localStorage.setItem("janusgraph.activeConnection", next);
      else localStorage.removeItem("janusgraph.activeConnection");
      return next;
    });
  }, []);

  const loadHistory = useCallback(async () => {
    if (!window.janusGraphDesktop) return;
    setHistory(
      await window.janusGraphDesktop.history.list(settings.historyLimit),
    );
  }, [settings.historyLimit]);

  useEffect(() => {
    void Promise.all([loadConnections(), loadHistory()]).catch((error) => {
      notify({ tone: "error", message: errorMessage(error) });
    });
  }, [loadConnections, loadHistory, notify]);

  useEffect(() => {
    if (view !== "query" || !activeQueryTab.connectionId) return;
    setActiveConnectionId(activeQueryTab.connectionId);
    localStorage.setItem(
      "janusgraph.activeConnection",
      activeQueryTab.connectionId,
    );
  }, [activeQueryTab.connectionId, view]);

  useEffect(() => {
    applySettings(settings);
    saveSettings(settings);
    const media = window.matchMedia("(prefers-color-scheme: light)");
    const syncSystemTheme = () => {
      if (settings.theme === "system") applySettings(settings);
    };
    media.addEventListener("change", syncSystemTheme);
    return () => media.removeEventListener("change", syncSystemTheme);
  }, [settings]);

  useEffect(() => {
    const persist = () =>
      saveQueryWorkspace(
        queryTabs,
        activeQueryTabId,
        queryTabSequence.current,
      );
    const timer = window.setTimeout(persist, 200);
    window.addEventListener("beforeunload", persist);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("beforeunload", persist);
    };
  }, [activeQueryTabId, queryTabs]);

  useEffect(() => {
    if (!toast || toast.dismissOnly) return;
    const timer = window.setTimeout(() => setToast(null), 4_500);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const executeFor = useCallback(
    async (
      connectionId: string,
      consoleId: string,
      nextQuery: string,
      bindings: Record<string, unknown> = {},
      recordHistory = true,
      executionId: string = crypto.randomUUID(),
      productionConfirmed = false,
      traversalSource?: string, timeoutMs?: number,
      serverCancellation = false,
      graphName?: string,
    ): Promise<QueryExecutionResult> => {
      if (!window.janusGraphDesktop) throw new Error("桌面 API 未加载");
      if (!connectionId) throw new Error("请先选择连接");
      const connection = connections.find((candidate) => candidate.id === connectionId);
      if (connection?.connectionReadOnly && isMutationQuery(nextQuery)) {
        throw new Error(tx(
          "连接级只读保护阻止了可能修改图数据或 Schema 的查询。请在连接设置中关闭只读保护后再试。",
          "Connection-level read-only protection blocked a query that may mutate graph data or schema. Disable it in the connection settings to continue.",
        ));
      }
      if (
        connection?.environment === "prod" &&
        isMutationQuery(nextQuery) &&
        !productionConfirmed
      ) {
        throw new Error(tx(
          "生产环境写操作需要先完成风险确认；当前入口未获得确认，已安全阻止执行。",
          "Production writes require risk confirmation. This action was blocked because its entry point did not obtain confirmation.",
        ));
      }
      const response = await window.janusGraphDesktop.queries.execute({
        connectionId,
        consoleId,
        executionId,
        query: nextQuery,
        graphName,
        traversalSource,
        bindings,
        recordHistory,
        productionConfirmed, timeoutMs, serverCancellation,
      });
      if (recordHistory) void loadHistory();
      return response;
    },
    [connections, loadHistory, tx],
  );

  const runQuery = useCallback(async (
    tabId = activeQueryTabId,
    queryOverride?: string,
    bindings: Record<string, unknown> = {},
    productionConfirmed = false,
  ) => {
    const tab = queryTabs.find((candidate) => candidate.id === tabId);
    if (!tab) return;
    const connection = connections.find(
      (candidate) => candidate.id === tab.connectionId,
    );
    if (!connection) {
      setView("connections");
      notify({ tone: "info", message: "请为当前查询标签页选择连接" });
      return;
    }
    const queryToExecute = queryOverride?.trim() || tab.query.trim();
    if (!queryToExecute) {
      notify({ tone: "error", message: "请输入 Gremlin 查询语句" });
      return;
    }
    const mutation = isMutationQuery(queryToExecute);
    if (tab.readOnly && mutation) {
      notify({
        tone: "error",
        message: tx(
          "只读保护阻止了可能修改图数据或 Schema 的查询，请先关闭当前标签页的只读模式。",
          "Read-only protection blocked a query that may mutate graph data or schema. Disable read-only mode for this tab first.",
        ),
      });
      return;
    }
    if (connection.connectionReadOnly && mutation) {
      notify({
        tone: "error",
        message: tx(
          "连接级只读保护阻止了可能修改图数据或 Schema 的查询。请在连接设置中关闭只读保护后再试。",
          "Connection-level read-only protection blocked a query that may mutate graph data or schema. Disable it in the connection settings to continue.",
        ),
      });
      return;
    }
    if (connection.environment === "prod" && mutation && !productionConfirmed) {
      setPendingProductionQuery({
        tabId,
        queryOverride: queryToExecute,
        bindings,
      });
      return;
    }
    const executionId = crypto.randomUUID();
    updateQueryTab(tabId, {
      selection: null,
      queryState: { status: "loading", executionId },
    });
    try {
      const response = await executeFor(
        connection.id, tab.id, queryToExecute, bindings, true,
        executionId, productionConfirmed,
        tab.traversalSourceOverride || undefined,
        tab.timeoutMsOverride || undefined,
        false,
        tab.graphBindingOverride || connection.graphBinding,
      );
      const graph = buildGraphModel(response.items);
      const preferred = settings.defaultResultMode;
      const analysisKind = traversalAnalysisKind(queryToExecute);
      const isConsoleReport = Boolean(analysisKind) || /\.printSchema\s*\(/i.test(queryToExecute);
      const nextMode = isConsoleReport
        ? "raw"
        : preferred === "auto"
          ? graph.nodes.length > 0
            ? "graph"
            : "table"
          : preferred === "graph" && graph.nodes.length === 0
            ? "table"
            : preferred;
      updateQueryTab(tabId, {
        title: !tab.scriptName && /^Query\s+\d+$/i.test(tab.title)
          ? queryToExecute.replace(/\s+/g, " ").slice(0, 28) || tab.title
          : tab.title,
        mode: nextMode,
        queryState: { status: "success", result: response, analysisKind },
      });
      notify({
        tone: "success",
        message: `${connection.name} · 查询完成：${response.items.length} 条，${response.durationMs} ms`,
      });
    } catch (error) {
      const message = errorMessage(error);
      updateQueryTab(tabId, {
        queryState: message.includes("查询已停止")
          ? {
              status: "cancelled",
              message: tx(
                "服务器请求已中断；Sessioned 标签页会在下次执行时建立新会话。",
                "The request was interrupted. A sessioned tab reconnects with a fresh session on its next run.",
              ),
            }
          : { status: "error", message },
      });
      if (message.includes("查询已停止")) {
        notify({ tone: "info", message: `${connection.name} · 查询已停止` });
      }
      void loadHistory();
    }
  }, [
    activeQueryTabId,
    connections,
    executeFor,
    loadHistory,
    notify,
    queryTabs,
    settings.defaultResultMode,
    tx,
    updateQueryTab,
  ]);

  const stopQuery = useCallback(async (tabId = activeQueryTabId) => {
    const tab = queryTabs.find((candidate) => candidate.id === tabId);
    if (!tab || tab.queryState.status !== "loading" || tab.queryState.stopping) {
      return;
    }
    const executionId = tab.queryState.executionId;
    if (!executionId) return;
    updateQueryTab(tabId, {
      queryState: { ...tab.queryState, stopping: true },
    });
    try {
      const cancelled = await window.janusGraphDesktop?.queries.cancel({ executionId });
      if (!cancelled) {
        notify({ tone: "info", message: "查询已经结束，无需停止" });
      }
    } catch (error) {
      updateQueryTab(tabId, {
        queryState: { status: "error", message: errorMessage(error) },
      });
    }
  }, [activeQueryTabId, notify, queryTabs, updateQueryTab]);

  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if ((event.target as Element | null)?.closest?.(".shortcut-recorder")) return;
      const editorFocused = Boolean(
        (event.target as Element | null)?.closest?.(".gremlin-editor"),
      );
      if (matchesShortcut(event, settings.keyboardShortcuts.openSettings)) {
        event.preventDefault();
        setView("settings");
      } else if (
        !editorFocused &&
        matchesShortcut(event, settings.keyboardShortcuts.runQuery)
      ) {
        event.preventDefault();
        void runQuery();
      } else if (
        !editorFocused &&
        matchesShortcut(event, settings.keyboardShortcuts.stopQuery)
      ) {
        event.preventDefault();
        void stopQuery();
      } else if (matchesShortcut(event, settings.keyboardShortcuts.newQueryTab)) {
        event.preventDefault();
        addQueryTab();
      } else if (matchesShortcut(event, settings.keyboardShortcuts.duplicateQueryTab)) {
        event.preventDefault();
        duplicateQueryTab(activeQueryTabId);
      } else if (matchesShortcut(event, settings.keyboardShortcuts.closeQueryTab)) {
        event.preventDefault();
        closeQueryTab(activeQueryTabId);
      } else if (matchesShortcut(event, settings.keyboardShortcuts.restoreClosedTab)) {
        event.preventDefault();
        restoreClosedQueryTab();
      } else if (matchesShortcut(event, settings.keyboardShortcuts.toggleSidebar)) {
        event.preventDefault();
        setSettings((current) => ({
          ...current,
          sidebarCollapsed: !current.sidebarCollapsed,
        }));
      } else if (
        matchesShortcut(event, settings.keyboardShortcuts.nextQueryTab) ||
        matchesShortcut(event, settings.keyboardShortcuts.previousQueryTab)
      ) {
        event.preventDefault();
        const index = queryTabs.findIndex((tab) => tab.id === activeQueryTabId);
        const direction = matchesShortcut(
          event,
          settings.keyboardShortcuts.nextQueryTab,
        )
          ? 1
          : -1;
        const nextIndex = (index + direction + queryTabs.length) % queryTabs.length;
        setActiveQueryTabId(queryTabs[nextIndex]!.id);
        setView("query");
      }
    };
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, [
    activeQueryTabId,
    addQueryTab,
    closeQueryTab,
    duplicateQueryTab,
    queryTabs,
    restoreClosedQueryTab,
    runQuery,
    stopQuery,
    settings.keyboardShortcuts,
  ]);

  useEffect(
    () =>
      window.janusGraphDesktop?.runtime.onNavigate((destination) => {
        if (destination === "settings") setView("settings");
      }),
    [],
  );

  const testStoredConnection = async (connection: ConnectionSummary, silent = false): Promise<ConnectionTestReport> => {
    if (!window.janusGraphDesktop) throw new Error("Desktop API unavailable");
    try {
      const input: SaveConnectionInput = {
        ...connection,
        password: undefined,
      };
      const report: ConnectionTestReport =
        await window.janusGraphDesktop.connections.test(input);
      if (!silent) {
        notify({
          tone: report.success ? "success" : "error",
          message: report.success
            ? `${connection.name} 连接正常，${report.latencyMs} ms`
            : report.message,
        });
      }
      return report;
    } catch (error) {
      if (!silent) notify({ tone: "error", message: errorMessage(error) });
      throw error;
    }
  };

  const openDiagnostics = (incident?: DiagnosticIncidentContext) => {
    setDiagnosticIncident(incident); setView("diagnostics");
  };

  const activeNav = NAV_ITEMS.find((item) => item.id === view) ?? NAV_ITEMS[0]!;
  const contextualConnection = view === "query" ? queryConnection : activeConnection;
  const contextualConnectionId =
    view === "query" ? activeQueryTab.connectionId : activeConnectionId;
  const navigateTo = (nextView: ViewId) => {
    if (nextView === "schema" && view !== "schema") {
      setSchemaGraphContext(null);
    }
    setView(nextView);
  };

  return (
    <LocaleProvider locale={settings.locale}>
    <div className={`app-shell ${settings.sidebarCollapsed ? "sidebar-collapsed" : ""}`}>
      <header className="app-header">
        <button type="button" className="brand" onClick={() => setView("query")}>
          <span className="brand-mark">
            <Waypoints size={23} />
          </span>
          <span>
            <strong>JANUS STUDIO</strong>
            <small title="A Modern Desktop IDE for JanusGraph & Apache TinkerPop">
              A Modern Desktop IDE for JanusGraph &amp; Apache TinkerPop
            </small>
          </span>
        </button>
        <div className="header-context">
          <span className="eyebrow">{activeNav.id.toUpperCase()}</span>
          <strong>{tx(activeNav.label)}</strong>
        </div>
        <div className="header-actions">
          <div className="connection-select">
            <span
              className={contextualConnection ? "status-light online" : "status-light"}
            />
            <SelectControl
              className="header-select"
              ariaLabel={
                view === "query"
                  ? tx("当前标签页连接", "Current tab connection")
                  : tx("当前连接")
              }
              value={contextualConnectionId}
              disabled={
                view === "query" && activeQueryTab.queryState.status === "loading"
              }
              onValueChange={(id) => {
                if (view === "query") {
                  const previousConnectionId = activeQueryTab.connectionId;
                  if (previousConnectionId && previousConnectionId !== id) {
                    void window.janusGraphDesktop?.queries.closeConsole({
                      connectionId: previousConnectionId,
                      consoleId: activeQueryTab.id,
                    });
                  }
                  updateQueryTab(activeQueryTab.id, {
                    connectionId: id,
                    traversalSourceOverride: "",
                    graphBindingOverride: "",
                    queryState: { status: "idle" },
                    selection: null,
                  });
                }
                setActiveConnectionId(id);
                if (id) localStorage.setItem("janusgraph.activeConnection", id);
                else localStorage.removeItem("janusgraph.activeConnection");
              }}
              options={[
                { value: "", label: tx("未选择连接") },
                ...connections.map((connection) => ({
                  value: connection.id,
                  label: connection.name,
                  description: `${connection.protocol.toUpperCase()} · ${
                    connection.clientMode === "sessioned"
                      ? "SESSIONED"
                      : "SESSIONLESS"
                  }`,
                })),
              ]}
            />
          </div>
          <button
            type="button"
            className="button secondary header-add"
            onClick={() => setConnectionDialog({ editing: null })}
          >
            <Plus size={17} />
            {tx("新建连接")}
          </button>
        </div>
      </header>

      <aside className="app-sidebar">
        <div className="sidebar-control">
          <span className="sidebar-control-label">{tx("工作区", "Workspace")}</span>
          <button
            type="button"
            aria-label={settings.sidebarCollapsed ? tx("展开侧栏") : tx("收起侧栏")}
            title={`${settings.sidebarCollapsed ? tx("展开侧栏") : tx("收起侧栏")} · ${shortcutLabel(settings.keyboardShortcuts.toggleSidebar)}`}
            onClick={() =>
              setSettings((current) => ({
                ...current,
                sidebarCollapsed: !current.sidebarCollapsed,
              }))
            }
          >
            {settings.sidebarCollapsed ? (
              <PanelLeftOpen size={18} />
            ) : (
              <PanelLeftClose size={18} />
            )}
          </button>
        </div>
        <nav aria-label={tx("主导航", "Main navigation")}>
          {NAV_ITEMS.filter((item) => item.primary !== false).map((item) => (
            <button
              type="button"
              key={item.id}
              className={view === item.id ? "is-active" : ""}
              aria-current={view === item.id ? "page" : undefined}
              title={tx(item.label)}
              onClick={() => navigateTo(item.id)}
            >
              <span className="nav-icon">{item.icon}</span>
              <span>
                <strong>{tx(item.label)}</strong>
                <small>{tx(item.description)}</small>
              </span>
            </button>
          ))}
        </nav>
        <div className="sidebar-status">
          <span className={contextualConnection ? "status-light online" : "status-light"} />
          <div>
            <strong>
              {contextualConnection ? tx("连接已配置") : tx("等待连接")}
            </strong>
            <small>
              {contextualConnection
                ? connectionEndpoint(contextualConnection)
                : tx("添加 JanusGraph Server")}
            </small>
          </div>
        </div>
      </aside>

      <main className="app-main" id="main-content">
        {view === "query" && (
          <QueryPage
            tabs={queryTabs}
            activeTabId={activeQueryTabId}
            onActivateTab={setActiveQueryTabId}
            onNewTab={() => addQueryTab()}
            onDuplicateTab={duplicateQueryTab}
            onRenameTab={renameQueryTab}
            onSetTabScriptName={(id, scriptName) => updateQueryTab(id, { scriptName })}
            onSetTabSavedContent={(id, savedContent) => updateQueryTab(id, { savedContent })}
            onCloseTab={closeQueryTab}
            onCloseOtherTabs={closeOtherQueryTabs}
            onCloseTabsToRight={closeQueryTabsToRight}
            onRestoreClosedTab={restoreClosedQueryTab}
            canRestoreClosedTab={closedQueryTabCount > 0}
            activeConnection={queryExecutionConnection}
            schemaCatalogKey={activeQueryTab.traversalSourceOverride
              ? `${activeQueryTab.connectionId}.${activeQueryTab.traversalSourceOverride}`
              : activeQueryTab.connectionId}
            query={activeQueryTab.query}
            setQuery={(query) => updateQueryTab(activeQueryTab.id, { query })}
            bindingsText={activeQueryTab.bindingsText}
            setBindingsText={(bindingsText) => updateQueryTab(activeQueryTab.id, { bindingsText })}
            bindingsEnabled={activeQueryTab.bindingsEnabled}
            setBindingsEnabled={(bindingsEnabled) => updateQueryTab(activeQueryTab.id, { bindingsEnabled })}
            timeoutMsOverride={activeQueryTab.timeoutMsOverride}
            setTimeoutMsOverride={(timeoutMsOverride) => updateQueryTab(activeQueryTab.id, { timeoutMsOverride })}
            readOnly={activeQueryTab.readOnly}
            setReadOnly={(readOnly) => updateQueryTab(activeQueryTab.id, { readOnly })}
            scriptName={activeQueryTab.scriptName}
            setScriptName={(scriptName) => updateQueryTab(activeQueryTab.id, { scriptName })}
            savedContent={activeQueryTab.savedContent}
            setSavedContent={(savedContent) => updateQueryTab(activeQueryTab.id, { savedContent })}
            queryState={activeQueryTab.queryState}
            runQuery={(queryOverride, bindings) => void runQuery(activeQueryTab.id, queryOverride, bindings)}
            stopQuery={() => void stopQuery(activeQueryTab.id)}
            mode={activeQueryTab.mode}
            setMode={(mode) => updateQueryTab(activeQueryTab.id, { mode })}
            selection={activeQueryTab.selection}
            setSelection={(selection) => updateQueryTab(activeQueryTab.id, { selection })}
            execute={(nextQuery, bindings, recordHistory) =>
              executeFor(
                activeQueryTab.connectionId,
                activeQueryTab.id,
                nextQuery,
                bindings,
                recordHistory,
                crypto.randomUUID(),
                false,
                activeQueryTab.traversalSourceOverride || undefined,
                activeQueryTab.timeoutMsOverride || undefined,
              )
            }
            settings={settings}
            onSettingsChange={setSettings}
            history={history}
            onOpenSnippet={(snippet) => openQueryAsset(snippet, "snippet")}
            onOpenQueryAssets={() => setView("history")}
            notify={notify}
          />
        )}
        {view === "connections" && (
          <ConnectionsPage
            connections={connections}
            activeConnectionId={activeConnectionId}
            onActivate={(id) => {
              setActiveConnectionId(id);
              localStorage.setItem("janusgraph.activeConnection", id);
              notify({ tone: "success", message: "当前连接已切换" });
            }}
            onAdd={() => setConnectionDialog({ editing: null })}
            onEdit={(editing) => setConnectionDialog({ editing })}
            onDelete={setDeleteConnection}
            onTest={testStoredConnection}
            onOpenDiagnostics={openDiagnostics}
            onConnectionsChanged={loadConnections}
          />
        )}
        {view === "history" && (
          <HistoryPage
            connections={connections}
            activeConnectionId={activeConnectionId}
            onOpenHistory={(entry) => openQueryAsset(entry, "history")}
            onOpenSnippet={(snippet) => openQueryAsset(snippet, "snippet")}
            notify={notify}
          />
        )}
        {view === "graphFactory" && (
          <GraphFactoryPage
            activeConnection={activeConnection}
            execute={(factoryQuery, bindings, productionConfirmed = false) =>
              executeFor(
                activeConnectionId,
                "graph-factory-console",
                factoryQuery,
                bindings,
                false,
                crypto.randomUUID(),
                productionConfirmed,
              )
            }
            onUseGraph={openGraphQueryContext}
            onManageSchema={(graph) => {
              setSchemaGraphContext(dynamicGraphContext(activeConnectionId, graph));
              setView("schema");
            }}
            onOpenDiagnostics={openDiagnostics}
            notify={notify}
          />
        )}
        {view === "schema" && (
          <SchemaPage
            activeConnection={schemaConnection}
            connectionProfile={activeConnection}
            graphContext={activeSchemaGraphContext}
            execute={(schemaQuery, productionConfirmed = false) =>
              executeFor(
                activeConnectionId,
                "schema-console",
                schemaQuery,
                {},
                false,
                crypto.randomUUID(),
                productionConfirmed,
                activeSchemaGraphContext?.traversalSource,
              )
            }
            onGraphContextChange={setSchemaGraphContext}
            onOpenQueryContext={(context) => openGraphQueryContext(context, context.connectionId)}
            onOpenGraphFactory={() => setView("graphFactory")}
            onOpenDiagnostics={openDiagnostics}
            notify={notify}
          />
        )}
        {view === "transfer" && (
          <TransferPage
            activeConnection={activeConnection}
            execute={(nextQuery, bindings, recordHistory, productionConfirmed, timeoutMs, executionId, serverCancellation) =>
              executeFor(
                activeConnectionId, "transfer-console",
                nextQuery,
                bindings,
                recordHistory,
                executionId ?? crypto.randomUUID(), productionConfirmed, undefined, timeoutMs, serverCancellation,
              )
            }
            notify={notify}
          />
        )}
        {view === "quality" && <QualityPage activeConnection={activeConnection} onOpenQuery={addQueryTab} requestedRun={qualityRunRequest} />}
        {view === "diagnostics" && <DiagnosticsPage incident={diagnosticIncident} />}
        {view === "settings" && (
          <SettingsPage
            settings={settings}
            onChange={setSettings}
          />
        )}
      </main>

      <footer className="app-statusbar">
        <div>
          <Activity size={14} />
          <span>{contextualConnection ? tx("READY") : tx("NO CONNECTION")}</span>
          {contextualConnection && (
            <span>{contextualConnection.protocol.toUpperCase()}</span>
          )}
        </div>
        <div>
          <TaskCenterHost center={backgroundTaskCenter} />
          <button
            type="button"
            className={`task-center-trigger ${view === "diagnostics" ? "is-active" : ""}`}
            aria-current={view === "diagnostics" ? "page" : undefined}
            title={tx("发生异常时生成脱敏诊断包", "Create a redacted bundle when something fails")}
            onClick={() => openDiagnostics()}
          >
            <Stethoscope size={14} />
            <span>{tx("问题诊断", "Diagnostics")}</span>
          </button>
          <GitBranch size={14} />
          <span>local workspace</span>
          <span>History {history.length}</span>
        </div>
      </footer>

      {connectionDialog && (
        <ConnectionDialog
          key={connectionDialog.editing?.id ?? "new"}
          editing={connectionDialog.editing}
          onClose={() => setConnectionDialog(null)}
          onSaved={(saved) => {
            setConnectionDialog(null);
            setActiveConnectionId(saved.id);
            if (view === "query" && !activeQueryTab.connectionId) {
              updateQueryTab(activeQueryTab.id, { connectionId: saved.id });
            }
            localStorage.setItem("janusgraph.activeConnection", saved.id);
            void loadConnections();
            notify({ tone: "success", message: `${saved.name} 已保存` });
          }}
        />
      )}
      {pendingProductionQuery && (() => {
        const pendingTab = queryTabs.find(
          (tab) => tab.id === pendingProductionQuery.tabId,
        );
        const productionConnection = connections.find(
          (connection) => connection.id === pendingTab?.connectionId,
        );
        if (!productionConnection) return null;
        return (
          <ConfirmDialog
            title={tx("确认生产环境写操作", "Confirm Production Write")}
            description={`${tx("生产连接", "Production connection")} “${productionConnection.name}”. ${tx(
              "当前 Gremlin 语句可能修改图数据或 Schema；执行前请确认连接与语句均正确。",
              "This Gremlin statement may mutate graph data or schema; verify the connection and statement before continuing.",
            )}`}
            confirmLabel={tx("仍要执行", "Run Anyway")}
            confirmIcon={<AlertTriangle size={17} />}
            onCancel={() => setPendingProductionQuery(null)}
            onConfirm={() => {
              const pending = pendingProductionQuery;
              setPendingProductionQuery(null);
              void runQuery(
                pending.tabId,
                pending.queryOverride,
                pending.bindings,
                true,
              );
            }}
          />
        );
      })()}
      {deleteConnection && (
        <ConfirmDialog
          title={tx("删除连接", "Delete Connection")}
          description={tx(
            `将删除“${deleteConnection.name}”及其本地加密凭据。服务器上的数据不会受到影响。`,
            `This removes “${deleteConnection.name}” and its local credential. Server data is not affected.`,
          )}
          confirmLabel={tx("删除连接", "Delete Connection")}
          onCancel={() => setDeleteConnection(null)}
          onConfirm={async () => {
            await window.janusGraphDesktop?.connections.remove(deleteConnection.id);
            setDeleteConnection(null);
            await loadConnections();
            notify({ tone: "success", message: "连接配置已删除" });
          }}
        />
      )}
      {toast && (
        <div
          className={`toast ${toast.tone}`}
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          {toast.tone === "success" ? (
            <CheckCircle2 size={18} />
          ) : toast.tone === "error" ? (
            <AlertTriangle size={18} />
          ) : (
            <Activity size={18} />
          )}
          <span>{toast.message}</span>
          <IconButton
            label={tx("关闭通知", "Dismiss notification")}
            onClick={() => setToast(null)}
          >
            <X size={16} />
          </IconButton>
        </div>
      )}
    </div>
    </LocaleProvider>
  );
}
