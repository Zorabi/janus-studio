import type {
  ConnectionSummary,
  QueryExecutionResult,
  QueryHistoryEntry,
  QuerySnippet,
} from "@janusgraph/domain";
import { routeCompatibility } from "@janusgraph/application";
import {
  Activity,
  AlertTriangle,
  AlignLeft,
  Braces,
  Check,
  CheckCircle2,
  CircleDot,
  Code2,
  Copy,
  Database,
  Download,
  Edit3,
  FileCode2,
  FileJson,
  FolderOpen,
  GitBranch,
  Hash,
  Layers3,
  LoaderCircle,
  MoreHorizontal,
  MoveRight,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  ShieldCheck,
  SlidersHorizontal,
  Square,
  Star,
  Table2,
  TerminalSquare,
  TimerReset,
  Trash2,
  Waypoints,
  X,
} from "lucide-react";
import {
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { GremlinEditor } from "../../components/GremlinEditor";
import { InteractiveGraph } from "../../components/InteractiveGraph";
import { EmptyState } from "../../components/ui";
import {
  EMPTY_SCHEMA_CATALOG,
  type GremlinSchemaCatalog,
} from "../../lib/gremlin-completion";
import { formatGremlin } from "../../lib/gremlin-format";
import { useTranslate } from "../../lib/i18n";
import { matchesShortcut, shortcutLabel } from "../../lib/keyboard";
import { safeIdentifier } from "../../lib/gremlin-identifiers";
import { errorMessage } from "../../lib/presentation";
import {
  buildGraphModel,
  buildTableRows,
  gremlinConsoleOutput,
  mergeGraphModels,
  structuredJsonItems,
  singleScalarResult,
  type GraphModel,
} from "../../lib/result-model";
import type { AppSettings } from "../../lib/settings";
import { parseTraversalDiagnostics } from "../../lib/traversal-diagnostics";
import { useCompatibilityProfile } from "../../lib/use-compatibility-profile";
import {
  configuredPropertyFields,
  gremlinFileName,
  hasDisplayProperty,
  parseBindings,
  tabTitleFromFileName,
  traversalAnalysisKind,
  withTraversalAnalysis,
} from "./query-utils";
import {
  appendQuerySuggestion,
  QueryHints,
} from "./QueryHints";
import { ElementInspector, TableResult } from "./QueryResultDetails";
import { TraversalDiagnosticsPanel } from "./TraversalDiagnosticsPanel";
import type {
  QueryState,
  QueryTabState,
  ResultMode,
  Selection,
  SelectionDetailState,
  ToastState,
} from "./query-workspace";

const EMPTY_GRAPH_MODEL: GraphModel = { nodes: [], edges: [] };

export function QueryPage({
  tabs,
  activeTabId,
  onActivateTab,
  onNewTab,
  onDuplicateTab,
  onRenameTab,
  onSetTabScriptName,
  onSetTabSavedContent,
  onCloseTab,
  onCloseOtherTabs,
  onCloseTabsToRight,
  onRestoreClosedTab,
  canRestoreClosedTab,
  activeConnection,
  schemaCatalogKey,
  query,
  setQuery,
  bindingsText,
  setBindingsText,
  bindingsEnabled,
  setBindingsEnabled,
  timeoutMsOverride,
  setTimeoutMsOverride,
  readOnly,
  setReadOnly,
  scriptName,
  setScriptName,
  savedContent,
  setSavedContent,
  queryState,
  runQuery,
  stopQuery,
  mode,
  setMode,
  selection,
  setSelection,
  execute,
  settings,
  onSettingsChange,
  history,
  onOpenSnippet,
  onOpenQueryAssets,
  notify,
}: {
  tabs: QueryTabState[];
  activeTabId: string;
  onActivateTab: (id: string) => void;
  onNewTab: () => void;
  onDuplicateTab: (id: string) => void;
  onRenameTab: (id: string, title: string) => void;
  onSetTabScriptName: (id: string, scriptName: string) => void;
  onSetTabSavedContent: (id: string, content: string) => void;
  onCloseTab: (id: string) => void;
  onCloseOtherTabs: (id: string) => void;
  onCloseTabsToRight: (id: string) => void;
  onRestoreClosedTab: () => void;
  canRestoreClosedTab: boolean;
  activeConnection: ConnectionSummary | undefined;
  schemaCatalogKey: string;
  query: string;
  setQuery: (query: string) => void;
  bindingsText: string;
  setBindingsText: (value: string) => void;
  bindingsEnabled: boolean;
  setBindingsEnabled: (value: boolean) => void;
  timeoutMsOverride: number;
  setTimeoutMsOverride: (value: number) => void;
  readOnly: boolean;
  setReadOnly: (value: boolean) => void;
  scriptName: string;
  setScriptName: (value: string) => void;
  savedContent: string;
  setSavedContent: (value: string) => void;
  queryState: QueryState;
  runQuery: (queryOverride?: string, bindings?: Record<string, unknown>) => void;
  stopQuery: () => void;
  mode: ResultMode;
  setMode: (mode: ResultMode) => void;
  selection: Selection;
  setSelection: (selection: Selection) => void;
  execute: (
    query: string,
    bindings?: Record<string, unknown>,
    recordHistory?: boolean,
  ) => Promise<QueryExecutionResult>;
  settings: AppSettings;
  onSettingsChange: (settings: AppSettings) => void;
  history: QueryHistoryEntry[];
  onOpenSnippet: (snippet: QuerySnippet) => void;
  onOpenQueryAssets: () => void;
  notify: (toast: ToastState) => void;
}) {
  const t = useTranslate();
  const compatibility = useCompatibilityProfile(activeConnection?.id);
  const explainRoute = routeCompatibility(compatibility.profile, "traversalExplain");
  const profileRoute = routeCompatibility(compatibility.profile, "traversalProfile");
  const schemaCatalog = useMemo<GremlinSchemaCatalog>(() => {
    if (!activeConnection) return EMPTY_SCHEMA_CATALOG;
    try {
      const stored = JSON.parse(
        localStorage.getItem(`janusgraph.schemaCatalog.v1.${schemaCatalogKey}`) ?? "null",
      ) as GremlinSchemaCatalog | null;
      return stored && Array.isArray(stored.vertexLabels) && Array.isArray(stored.edgeLabels) && Array.isArray(stored.propertyKeys)
        ? stored
        : EMPTY_SCHEMA_CATALOG;
    } catch {
      return EMPTY_SCHEMA_CATALOG;
    }
  }, [activeConnection?.id, schemaCatalogKey]);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [monacoSuggestionsOpen, setMonacoSuggestionsOpen] = useState(false);
  const [diagnosticView, setDiagnosticView] = useState<"diagnostics" | "console">("diagnostics");
  const [parametersOpen, setParametersOpen] = useState(false);
  const [bindingsError, setBindingsError] = useState("");
  const [favoritesOpen, setFavoritesOpen] = useState(false);
  const [transactionPanelOpen, setTransactionPanelOpen] = useState(false);
  const [tabMenu, setTabMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [renamingTabId, setRenamingTabId] = useState<string | null>(null);
  const [renamingTabTitle, setRenamingTabTitle] = useState("");
  const [savedQueries, setSavedQueries] = useState<QuerySnippet[]>([]);
  const [savedQueriesLoading, setSavedQueriesLoading] = useState(false);
  const [savedQueryName, setSavedQueryName] = useState("");
  const [renamingSavedQueryId, setRenamingSavedQueryId] = useState<string | null>(null);
  const [renamingSavedQueryName, setRenamingSavedQueryName] = useState("");
  const [snippetQueryDraft, setSnippetQueryDraft] = useState("");
  const [fullExporting, setFullExporting] = useState(false);
  const [transactionBusy, setTransactionBusy] = useState<"begin" | "commit" | "rollback" | null>(null);
  const [activeTransactions, setActiveTransactions] = useState<Record<string, true>>({});
  const [selectedQuery, setSelectedQuery] = useState("");
  const [selectionDetail, setSelectionDetail] =
    useState<SelectionDetailState>({ status: "idle" });
  const selectionRequestRef = useRef(0);
  const captionHydrationAttemptsRef = useRef(new Set<string>());
  const pendingTransactionDispositionRef = useRef<boolean | null>(null);
  const [graphEnrichment, setGraphEnrichment] = useState<
    Record<string, GraphModel>
  >({});
  const queryTabsScrollRef = useRef<HTMLDivElement>(null);
  const queryWorkbenchRef = useRef<HTMLDivElement>(null);
  const tabMenuRef = useRef<HTMLDivElement>(null);
  const [editorPanePercent, setEditorPanePercent] = useState(() => {
    const stored = Number(localStorage.getItem("janusgraph.queryEditorPanePercent.v1"));
    return Number.isFinite(stored) ? Math.min(72, Math.max(24, stored)) : 42;
  });
  const transactionKey = activeConnection
    ? `${activeConnection.id}:${activeTabId}`
    : activeTabId;
  const transactionActive = Boolean(activeTransactions[transactionKey]);

  const resizeQueryPanels = useCallback((clientY: number) => {
    const workbench = queryWorkbenchRef.current;
    if (!workbench) return;
    const bounds = workbench.getBoundingClientRect();
    const tabsHeight = workbench.querySelector<HTMLElement>(".query-tabs")?.offsetHeight ?? 44;
    const contentTop = bounds.top + tabsHeight + 14;
    const contentHeight = Math.max(1, bounds.bottom - 14 - contentTop - 10);
    const next = Math.min(72, Math.max(24, ((clientY - contentTop) / contentHeight) * 100));
    setEditorPanePercent(next);
    localStorage.setItem("janusgraph.queryEditorPanePercent.v1", String(Math.round(next * 10) / 10));
  }, []);

  const beginPanelResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const move = (pointerEvent: PointerEvent) => resizeQueryPanels(pointerEvent.clientY);
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      document.body.classList.remove("is-resizing-query-panels");
    };
    document.body.classList.add("is-resizing-query-panels");
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop, { once: true });
  };

  useEffect(() => {
    const activeTab = queryTabsScrollRef.current?.querySelector<HTMLElement>(
      `[data-query-tab-id="${activeTabId}"]`,
    );
    activeTab?.scrollIntoView({
      behavior: settings.reduceMotion ? "auto" : "smooth",
      block: "nearest",
      inline: "nearest",
    });
  }, [activeTabId, settings.reduceMotion, tabs.length]);

  useEffect(() => {
    if (!tabMenu) return;
    const close = () => setTabMenu(null);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [tabMenu]);

  useLayoutEffect(() => {
    const menu = tabMenuRef.current;
    if (!tabMenu || !menu) return;
    const bounds = menu.getBoundingClientRect();
    const edge = 12;
    const nextX = Math.max(edge, Math.min(tabMenu.x, window.innerWidth - bounds.width - edge));
    const nextY = Math.max(edge, Math.min(tabMenu.y, window.innerHeight - bounds.height - edge));
    if (nextX !== tabMenu.x || nextY !== tabMenu.y) {
      setTabMenu({ ...tabMenu, x: nextX, y: nextY });
    }
  }, [tabMenu]);

  const beginRenameTab = (tab: QueryTabState) => {
    setTabMenu(null);
    setRenamingTabId(tab.id);
    setRenamingTabTitle(tab.title);
  };

  const commitTabRename = () => {
    if (!renamingTabId) return;
    const title = renamingTabTitle.trim();
    if (title) onRenameTab(renamingTabId, title);
    setRenamingTabId(null);
  };
  const result = queryState.status === "success" ? queryState.result : null;
  const analysisKind = queryState.status === "success" ? queryState.analysisKind : undefined;
  const traversalDiagnostic = useMemo(
    () => result && analysisKind ? parseTraversalDiagnostics(result.items, analysisKind) : null,
    [analysisKind, result],
  );
  const consoleOutput = useMemo(
    () => result?.consoleText ?? (result ? gremlinConsoleOutput(result.items) : ""),
    [result],
  );
  useEffect(() => {
    if (analysisKind) setDiagnosticView("diagnostics");
  }, [analysisKind, result?.executionId]);
  const tableRows = useMemo(
    () => (result ? buildTableRows(result.items) : []),
    [result],
  );
  const scalarResult = useMemo(
    () => (result ? singleScalarResult(result.items) : null),
    [result],
  );
  const structuredItems = useMemo(
    () => (result ? structuredJsonItems(result.items) : []),
    [result],
  );
  const baseGraph = useMemo(
    () => (result ? buildGraphModel(result.items) : { nodes: [], edges: [] }),
    [result],
  );
  const graph = useMemo(
    () => result && graphEnrichment[result.executionId]
      ? mergeGraphModels(baseGraph, graphEnrichment[result.executionId]!)
      : baseGraph,
    [baseGraph, graphEnrichment, result],
  );

  useEffect(() => {
    setSuggestionsOpen(false);
    setMonacoSuggestionsOpen(false);
    setParametersOpen(false);
    setBindingsError("");
    setFavoritesOpen(false);
    setTransactionPanelOpen(false);
    setSelectedQuery("");
    selectionRequestRef.current += 1;
    setSelectionDetail({ status: "idle" });
  }, [activeConnection?.id, activeTabId]);

  const hasExecutableSelection = selectedQuery.trim().length > 0;
  const setTransactionActive = useCallback((active: boolean) => {
    setActiveTransactions((current) => {
      if (active) return { ...current, [transactionKey]: true };
      const next = { ...current };
      delete next[transactionKey];
      return next;
    });
  }, [transactionKey]);

  const runEditorQuery = useCallback((selectionValue?: string) => {
    try {
      const bindings = bindingsEnabled ? parseBindings(bindingsText) : {};
      setBindingsError("");
      const selected = selectionValue ?? selectedQuery;
      const executable = selected.trim() ? selected : query;
      const analysis = traversalAnalysisKind(executable);
      const analysisRoute = analysis === "explain" ? explainRoute : analysis === "profile" ? profileRoute : null;
      if (analysis && compatibility.loading) {
        notify({ tone: "info", message: t("正在确认服务端诊断能力", "Checking server diagnostic capability") });
        return;
      }
      if (analysisRoute?.status === "unavailable") {
        notify({
          tone: "error",
          message: analysis === "explain"
            ? t("当前服务端不支持 Explain 遍历诊断", "The server does not support Explain traversal diagnostics")
            : t("当前服务端不支持 Profile 遍历诊断", "The server does not support Profile traversal diagnostics"),
        });
        return;
      }
      if (activeConnection?.clientMode === "sessioned") {
        const closesTransaction = /\.tx\s*\(\)\s*\.\s*(?:commit|rollback)\s*\(/i.test(executable);
        pendingTransactionDispositionRef.current = !closesTransaction;
      }
      runQuery(selected.trim() ? selected : undefined, bindings);
    } catch (error) {
      setBindingsError(errorMessage(error));
      setParametersOpen(true);
      notify({ tone: "error", message: errorMessage(error) });
    }
  }, [activeConnection?.clientMode, bindingsEnabled, bindingsText, compatibility.loading, explainRoute.status, notify, profileRoute.status, query, runQuery, selectedQuery, t]);

  useEffect(() => {
    if (queryState.status === "success") {
      if (pendingTransactionDispositionRef.current !== null) {
        setTransactionActive(pendingTransactionDispositionRef.current);
        pendingTransactionDispositionRef.current = null;
      }
    } else if (queryState.status === "error" || queryState.status === "cancelled") {
      pendingTransactionDispositionRef.current = null;
    }
  }, [queryState.status, setTransactionActive]);

  const formatEditorQuery = useCallback(() => {
    const formatted = formatGremlin(query);
    if (formatted === query) return;
    setQuery(formatted);
    notify({ tone: "success", message: t("Gremlin 查询已格式化", "Gremlin query formatted") });
  }, [notify, query, setQuery, t]);

  useEffect(() => {
    if (!settings.querySuggestionsEnabled) {
      setSuggestionsOpen(false);
      return;
    }
    const toggleSuggestions = (event: KeyboardEvent) => {
      if (!matchesShortcut(event, settings.keyboardShortcuts.toggleSuggestions)) {
        return;
      }
      event.preventDefault();
      setSuggestionsOpen((current) => !current);
    };
    window.addEventListener("keydown", toggleSuggestions);
    return () => window.removeEventListener("keydown", toggleSuggestions);
  }, [settings.keyboardShortcuts.toggleSuggestions, settings.querySuggestionsEnabled]);

  const mergeGraphEnrichment = useCallback(
    (model: GraphModel) => {
      if (!result) return;
      setGraphEnrichment((current) => ({
        ...current,
        [result.executionId]: current[result.executionId]
          ? mergeGraphModels(current[result.executionId]!, model)
          : model,
      }));
    },
    [result],
  );

  useEffect(() => {
    if (!result) return;
    const vertexFields = configuredPropertyFields(
      settings.graphVertexLabelFields,
    );
    const edgeFields = configuredPropertyFields(settings.graphEdgeLabelFields);
    const vertexFieldKey = vertexFields.join(",");
    const edgeFieldKey = edgeFields.join(",");
    const attemptPrefix = result.executionId;

    const nodes = vertexFields.length
      ? graph.nodes
          .slice(0, settings.graphNodeLimit)
          .filter((node) => !hasDisplayProperty(node, vertexFields))
          .filter(
            (node) =>
              !captionHydrationAttemptsRef.current.has(
                `${attemptPrefix}:node:${vertexFieldKey}:${node.id}`,
              ),
          )
      : [];
    const edges = edgeFields.length
      ? graph.edges
          .slice(0, settings.graphEdgeLimit)
          .filter((edge) => !hasDisplayProperty(edge, edgeFields))
          .filter(
            (edge) =>
              !captionHydrationAttemptsRef.current.has(
                `${attemptPrefix}:edge:${edgeFieldKey}:${edge.id}`,
              ),
          )
      : [];

    nodes.forEach((node) =>
      captionHydrationAttemptsRef.current.add(
        `${attemptPrefix}:node:${vertexFieldKey}:${node.id}`,
      ),
    );
    edges.forEach((edge) =>
      captionHydrationAttemptsRef.current.add(
        `${attemptPrefix}:edge:${edgeFieldKey}:${edge.id}`,
      ),
    );
    if (nodes.length === 0 && edges.length === 0) return;

    let cancelled = false;
    const requests: Array<Promise<QueryExecutionResult>> = [];
    if (nodes.length > 0) {
      requests.push(
        execute(
          "g.V().hasId(within(elementIds)).elementMap()",
          { elementIds: nodes.map((node) => node.rawId ?? node.id) },
          false,
        ),
      );
    }
    if (edges.length > 0) {
      requests.push(
        execute(
          "g.E().hasId(within(elementIds)).elementMap()",
          { elementIds: edges.map((edge) => edge.rawId ?? edge.id) },
          false,
        ),
      );
    }

    void Promise.all(requests)
      .then((responses) => {
        if (cancelled) return;
        const enrichment = responses.reduce(
          (current, response) =>
            mergeGraphModels(current, buildGraphModel(response.items)),
          EMPTY_GRAPH_MODEL,
        );
        mergeGraphEnrichment(enrichment);
      })
      .catch(() => {
        // Caption enrichment is optional. The original result remains interactive.
      });
    return () => {
      cancelled = true;
    };
  }, [
    execute,
    graph,
    mergeGraphEnrichment,
    result,
    settings.graphEdgeLabelFields,
    settings.graphEdgeLimit,
    settings.graphNodeLimit,
    settings.graphVertexLabelFields,
  ]);

  useEffect(() => {
    if (selection) return;
    selectionRequestRef.current += 1;
    setSelectionDetail({ status: "idle" });
  }, [selection]);

  const selectGraphElement = useCallback(
    (next: Selection) => {
      const requestId = ++selectionRequestRef.current;
      setSelection(next);
      if (!next) {
        setSelectionDetail({ status: "idle" });
        return;
      }

      const hasExistingProperties =
        Object.keys(next.value.properties).length > 0;
      setSelectionDetail(
        hasExistingProperties ? { status: "idle" } : { status: "loading" },
      );
      const detailQuery =
        next.kind === "node"
          ? "g.V(elementId).elementMap()"
          : "g.E(elementId).elementMap()";

      void execute(
        detailQuery,
        { elementId: next.value.rawId ?? next.value.id },
        false,
      )
        .then((response) => {
          if (selectionRequestRef.current !== requestId) return;
          const details = buildGraphModel(response.items);
          if (next.kind === "node") {
            const detail =
              details.nodes.find((node) => node.id === next.value.id) ??
              details.nodes[0];
            if (!detail) {
              setSelectionDetail(
                hasExistingProperties
                  ? { status: "idle" }
                  : {
                      status: "error",
                      message: t(
                        "JanusGraph 未返回该顶点的属性。",
                        "JanusGraph did not return properties for this vertex.",
                      ),
                    },
              );
              return;
            }
            mergeGraphEnrichment(details);
            setSelection({
              kind: "node",
              value: {
                ...next.value,
                ...detail,
                rawId: next.value.rawId ?? detail.rawId,
                properties: {
                  ...next.value.properties,
                  ...detail.properties,
                },
              },
            });
          } else {
            const detail =
              details.edges.find((edge) => edge.id === next.value.id) ??
              details.edges[0];
            if (!detail) {
              setSelectionDetail(
                hasExistingProperties
                  ? { status: "idle" }
                  : {
                      status: "error",
                      message: t(
                        "JanusGraph 未返回该关系的属性。",
                        "JanusGraph did not return properties for this edge.",
                      ),
                    },
              );
              return;
            }
            mergeGraphEnrichment(details);
            setSelection({
              kind: "edge",
              value: {
                ...next.value,
                ...detail,
                rawId: next.value.rawId ?? detail.rawId,
                properties: {
                  ...next.value.properties,
                  ...detail.properties,
                },
              },
            });
          }
          setSelectionDetail({ status: "idle" });
        })
        .catch((error) => {
          if (selectionRequestRef.current !== requestId) return;
          setSelectionDetail(
            hasExistingProperties
              ? { status: "idle" }
              : {
                  status: "error",
                  message: errorMessage(error),
                },
          );
        });
    },
    [execute, mergeGraphEnrichment, setSelection, t],
  );


  const exportResult = async (format: "json" | "jsonl" | "csv") => {
    if (!result || !window.janusGraphDesktop) return;
    try {
      const path = await window.janusGraphDesktop.files.saveResultFile({
        suggestedName: `janusgraph-query-${Date.now()}.${format}`,
        format,
        items: format === "csv" ? tableRows : structuredItems,
      });
      if (path) {
        notify({
          tone: "success",
          message: t(`查询结果已保存到 ${path}`, `Query result saved to ${path}`),
        });
      }
    } catch (error) {
      notify({ tone: "error", message: errorMessage(error) });
    }
  };

  const exportCompleteResult = async () => {
    if (!activeConnection || !window.janusGraphDesktop || !query.trim()) return;
    setFullExporting(true);
    try {
      const exported = await window.janusGraphDesktop.queries.export({
        connectionId: activeConnection.id,
        executionId: crypto.randomUUID(),
        query,
        traversalSource: activeConnection.traversalSource,
        bindings: parseBindings(bindingsText),
        suggestedName: `janusgraph-query-complete-${Date.now()}.jsonl`,
        format: "jsonl",
      });
      if (exported.path) {
        notify({
          tone: "success",
          message: t(
            `已流式导出 ${exported.totalCount.toLocaleString()} 条结果到 ${exported.path}`,
            `Streamed ${exported.totalCount.toLocaleString()} results to ${exported.path}`,
          ),
        });
      }
    } catch (error) {
      notify({ tone: "error", message: errorMessage(error) });
    } finally {
      setFullExporting(false);
    }
  };

  const openScript = async () => {
    if (!window.janusGraphDesktop) return;
    try {
      const file = await window.janusGraphDesktop.files.pickQueryFile();
      if (!file) return;
      setQuery(file.content);
      setScriptName(file.name);
      setSavedContent(file.content);
      onRenameTab(activeTabId, tabTitleFromFileName(file.name));
      notify({ tone: "success", message: t(`已打开 ${file.name}`, `Opened ${file.name}`) });
    } catch (error) {
      notify({ tone: "error", message: errorMessage(error) });
    }
  };

  const saveScript = async () => {
    if (!window.janusGraphDesktop) return;
    try {
      const activeTabTitle = tabs.find((tab) => tab.id === activeTabId)?.title ?? "query";
      const path = await window.janusGraphDesktop.files.saveQueryFile({
        suggestedName: gremlinFileName(activeTabTitle),
        content: query,
      });
      if (!path) return;
      const name = path.split(/[\\/]/).at(-1) ?? "query.gremlin";
      setScriptName(name);
      setSavedContent(query);
      onRenameTab(activeTabId, tabTitleFromFileName(name));
      notify({ tone: "success", message: t(`脚本已保存到 ${path}`, `Script saved to ${path}`) });
    } catch (error) {
      notify({ tone: "error", message: errorMessage(error) });
    }
  };

  useEffect(() => {
    const saveShortcut = (event: KeyboardEvent) => {
      if (!matchesShortcut(event, settings.keyboardShortcuts.saveQuery)) return;
      event.preventDefault();
      event.stopPropagation();
      if (query.trim()) void saveScript();
    };
    window.addEventListener("keydown", saveShortcut, true);
    return () => window.removeEventListener("keydown", saveShortcut, true);
  }, [activeTabId, query, settings.keyboardShortcuts.saveQuery, tabs]);

  const saveTabScript = async (tab: QueryTabState) => {
    if (!window.janusGraphDesktop || !tab.query.trim()) return;
    try {
      const path = await window.janusGraphDesktop.files.saveQueryFile({
        suggestedName: gremlinFileName(tab.title),
        content: tab.query,
      });
      if (!path) return;
      const name = path.split(/[\\/]/).at(-1) ?? "query.gremlin";
      onSetTabScriptName(tab.id, name);
      onSetTabSavedContent(tab.id, tab.query);
      onRenameTab(tab.id, tabTitleFromFileName(name));
      notify({ tone: "success", message: t(`脚本已保存到 ${path}`, `Script saved to ${path}`) });
    } catch (error) {
      notify({ tone: "error", message: errorMessage(error) });
    } finally {
      setTabMenu(null);
    }
  };

  const loadSavedQueries = useCallback(async () => {
    if (!window.janusGraphDesktop) return;
    setSavedQueriesLoading(true);
    try { setSavedQueries(await window.janusGraphDesktop.queryAssets.listSnippets({ limit: 200 })); }
    catch (error) { notify({ tone: "error", message: errorMessage(error) }); }
    finally { setSavedQueriesLoading(false); }
  }, [notify]);

  useEffect(() => { void loadSavedQueries(); }, [loadSavedQueries]);

  const openSnippetPanel = (selection?: string) => {
    const source = selection?.trim() || query;
    if (!source.trim()) {
      notify({ tone: "info", message: t("当前查询为空", "The current query is empty") });
      return;
    }
    setSnippetQueryDraft(source);
    setSavedQueryName(tabs.find((tab) => tab.id === activeTabId)?.title ?? "");
    setFavoritesOpen(true);
    setParametersOpen(false);
    setSuggestionsOpen(false);
  };

  const addSavedQuery = async () => {
    const source = snippetQueryDraft.trim() || query.trim();
    if (!source || !window.janusGraphDesktop) return;
    const compact = source.replace(/\s+/g, " ").trim();
    const tabTitle = tabs.find((tab) => tab.id === activeTabId)?.title;
    try {
      await window.janusGraphDesktop.queryAssets.saveSnippet({
      name: savedQueryName.trim() || tabTitle || compact.slice(0, 56),
      description: "",
      query: source,
      bindingsText,
      connectionId: activeConnection?.id ?? "",
      graphName: activeConnection?.graphBinding ?? "",
      traversalSource: activeConnection?.traversalSource ?? "",
      folderId: "", starred: true, tagIds: [],
      });
      setSavedQueryName(""); setSnippetQueryDraft(""); await loadSavedQueries();
      notify({ tone: "success", message: t("查询已保存为 Snippet", "Query saved as a Snippet") });
    } catch (error) { notify({ tone: "error", message: errorMessage(error) }); }
  };

  const commitSavedQueryRename = async (id: string) => {
    const name = renamingSavedQueryName.trim();
    const snippet = savedQueries.find((entry) => entry.id === id);
    if (name && snippet && window.janusGraphDesktop) {
      await window.janusGraphDesktop.queryAssets.saveSnippet({
        ...snippet, name, tagIds: snippet.tags.map((tag) => tag.id),
      });
      await loadSavedQueries();
    }
    setRenamingSavedQueryId(null);
    setRenamingSavedQueryName("");
  };

  const removeSavedQuery = async (id: string) => {
    await window.janusGraphDesktop?.queryAssets.removeSnippet(id);
    await loadSavedQueries();
  };

  const beginTransaction = useCallback(async () => {
    if (!activeConnection || activeConnection.clientMode !== "sessioned") return;
    setTransactionBusy("begin");
    try {
      const graph = safeIdentifier(activeConnection.graphBinding);
      await execute(`if (!${graph}.tx().isOpen()) { ${graph}.tx().open() }; ${graph}.tx().isOpen()`, {}, false);
      setTransactionActive(true);
      notify({
        tone: "success",
        message: t(
          "当前标签页事务已开启，后续查询将复用同一会话",
          "The tab transaction is open; subsequent queries reuse the same session",
        ),
      });
    } catch (error) {
      notify({ tone: "error", message: errorMessage(error) });
    } finally {
      setTransactionBusy(null);
    }
  }, [activeConnection, execute, notify, setTransactionActive, t]);

  const finishTransaction = useCallback(async (action: "commit" | "rollback") => {
    if (!activeConnection || activeConnection.clientMode !== "sessioned") return;
    setTransactionBusy(action);
    try {
      const graph = safeIdentifier(activeConnection.graphBinding);
      await execute(`${graph}.tx().${action}()`, {}, false);
      setTransactionActive(false);
      notify({
        tone: "success",
        message: action === "commit"
          ? t("当前标签页事务已提交", "The tab transaction was committed")
          : t("当前标签页事务已回滚", "The tab transaction was rolled back"),
      });
    } catch (error) {
      notify({ tone: "error", message: errorMessage(error) });
    } finally {
      setTransactionBusy(null);
    }
  }, [activeConnection, execute, notify, setTransactionActive, t]);

  useEffect(() => {
    const handleTransactionShortcut = (event: KeyboardEvent) => {
      if (!activeConnection || activeConnection.clientMode !== "sessioned") return;
      if (matchesShortcut(event, settings.keyboardShortcuts.beginTransaction)) {
        event.preventDefault();
        void beginTransaction();
      } else if (matchesShortcut(event, settings.keyboardShortcuts.commitTransaction)) {
        event.preventDefault();
        void finishTransaction("commit");
      } else if (matchesShortcut(event, settings.keyboardShortcuts.rollbackTransaction)) {
        event.preventDefault();
        void finishTransaction("rollback");
      }
    };
    window.addEventListener("keydown", handleTransactionShortcut);
    return () => window.removeEventListener("keydown", handleTransactionShortcut);
  }, [activeConnection, beginTransaction, finishTransaction, settings.keyboardShortcuts]);

  return (
    <div
      ref={queryWorkbenchRef}
      className="query-workbench"
      style={{ gridTemplateRows: `auto minmax(180px, ${editorPanePercent}fr) 10px minmax(220px, ${100 - editorPanePercent}fr)` }}
    >
      <nav
        className={`query-tabs is-${settings.queryTabLayout}`}
        aria-label={t("查询标签页", "Query tabs")}
      >
        <div
          className="query-tabs-scroll"
          ref={queryTabsScrollRef}
          role="tablist"
          onWheel={(event) => {
            if (settings.queryTabLayout !== "scroll") return;
            const target = event.currentTarget;
            if (target.scrollWidth <= target.clientWidth || event.deltaY === 0) return;
            target.scrollLeft += event.deltaY;
          }}
        >
          {tabs.map((tab) => (
            <div
              key={tab.id}
              data-query-tab-id={tab.id}
              className={`query-tab ${tab.id === activeTabId ? "is-active" : ""} ${tab.query !== tab.savedContent ? "is-dirty" : "is-saved"}`}
              onContextMenu={(event) => {
                event.preventDefault();
                onActivateTab(tab.id);
                setTabMenu({
                  id: tab.id,
                  x: Math.max(12, Math.min(event.clientX, window.innerWidth - 304)),
                  y: Math.max(12, Math.min(event.clientY, window.innerHeight - 390)),
                });
              }}
            >
              {renamingTabId === tab.id ? (
                <input
                  className="query-tab-rename"
                  value={renamingTabTitle}
                  autoFocus
                  maxLength={80}
                  aria-label={t("重命名标签页", "Rename tab")}
                  onChange={(event) => setRenamingTabTitle(event.target.value)}
                  onFocus={(event) => event.currentTarget.select()}
                  onBlur={commitTabRename}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") event.currentTarget.blur();
                    if (event.key === "Escape") {
                      setRenamingTabId(null);
                      event.stopPropagation();
                    }
                  }}
                />
              ) : (
                <button
                  type="button"
                  role="tab"
                  aria-selected={tab.id === activeTabId}
                  onClick={() => onActivateTab(tab.id)}
                  onDoubleClick={() => beginRenameTab(tab)}
                >
                  <span className={`query-tab-status is-${tab.queryState.status}`} />
                  <span>{tab.title}</span>
                  <span
                    className="query-tab-save-state"
                    title={tab.query !== tab.savedContent
                      ? t("有未保存的更改", "Unsaved changes")
                      : tab.scriptName
                        ? t("已保存到文件", "Saved to file")
                        : t("空白标签页", "Blank tab")}
                    aria-label={tab.query !== tab.savedContent
                      ? t("有未保存的更改", "Unsaved changes")
                      : t("内容已保存", "Content saved")}
                  />
                </button>
              )}
              <button
                type="button"
                className="query-tab-more"
                aria-label={t(`${tab.title} 标签页操作`, `${tab.title} tab actions`)}
                aria-haspopup="menu"
                aria-expanded={tabMenu?.id === tab.id}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation();
                  const rect = event.currentTarget.getBoundingClientRect();
                  setTabMenu((current) => current?.id === tab.id
                    ? null
                    : {
                        id: tab.id,
                        x: Math.max(12, Math.min(rect.right - 292, window.innerWidth - 304)),
                        y: Math.max(12, Math.min(rect.bottom + 8, window.innerHeight - 390)),
                      });
                }}
              >
                <MoreHorizontal size={14} />
              </button>
              <button
                type="button"
                className="query-tab-close"
                aria-label={t(`关闭 ${tab.title}`, `Close ${tab.title}`)}
                onClick={() => onCloseTab(tab.id)}
              >
                <X size={14} />
              </button>
            </div>
          ))}
        </div>
        <button
          type="button"
          className="query-tab-new"
          onClick={onNewTab}
          aria-label={t("新建查询标签页", "New query tab")}
          title={`${t("新建查询标签页", "New query tab")} · ${shortcutLabel(settings.keyboardShortcuts.newQueryTab)}`}
        >
          <Plus size={17} />
        </button>
        <button
          type="button"
          className="query-tab-restore"
          onClick={onRestoreClosedTab}
          disabled={!canRestoreClosedTab}
          aria-label={t("恢复关闭的查询标签页", "Reopen closed query tab")}
          title={`${t("恢复关闭的查询标签页", "Reopen closed query tab")} · ${shortcutLabel(settings.keyboardShortcuts.restoreClosedTab)}`}
        >
          <RotateCcw size={16} />
        </button>
        {tabMenu && createPortal((() => {
          const tab = tabs.find((candidate) => candidate.id === tabMenu.id);
          if (!tab) return null;
          const tabIndex = tabs.findIndex((candidate) => candidate.id === tab.id);
          return (
            <div
              ref={tabMenuRef}
              className="query-tab-menu"
              role="menu"
              style={{ left: tabMenu.x, top: tabMenu.y }}
              onPointerDown={(event) => event.stopPropagation()}
            >
              <header>
                <span>TAB ACTIONS</span>
                <strong title={tab.title}>{tab.title}</strong>
                <small>{tab.query !== tab.savedContent
                  ? `${tab.scriptName || t("未命名脚本", "Untitled script")} · ${t("有未保存的更改", "Unsaved changes")}`
                  : tab.scriptName
                    ? `${tab.scriptName} · ${t("已保存", "Saved")}`
                    : t("空白标签页", "Blank tab")}</small>
              </header>
              <button type="button" role="menuitem" disabled={!tab.query.trim()} onClick={() => void saveTabScript(tab)}>
                <Save size={15} />
                <span>{t("保存为 Gremlin 文件", "Save as Gremlin file")}</span>
              </button>
              <button type="button" role="menuitem" onClick={() => beginRenameTab(tab)}>
                <Edit3 size={15} />
                <span>{t("重命名", "Rename")}</span>
              </button>
              <button type="button" role="menuitem" onClick={() => { onDuplicateTab(tab.id); setTabMenu(null); }}>
                <Copy size={15} />
                <span>{t("复制标签页", "Duplicate tab")}</span>
              </button>
              <span className="query-tab-menu-divider" />
              <button type="button" role="menuitem" disabled={tabs.length <= 1} onClick={() => { onCloseOtherTabs(tab.id); setTabMenu(null); }}>
                <Layers3 size={15} />
                <span>{t("关闭其他标签页", "Close other tabs")}</span>
              </button>
              <button type="button" role="menuitem" disabled={tabIndex === tabs.length - 1} onClick={() => { onCloseTabsToRight(tab.id); setTabMenu(null); }}>
                <X size={15} />
                <span>{t("关闭右侧标签页", "Close tabs to the right")}</span>
              </button>
              <button type="button" role="menuitem" className="is-danger" onClick={() => { onCloseTab(tab.id); setTabMenu(null); }}>
                <X size={15} />
                <span>{t("关闭标签页", "Close tab")}</span>
              </button>
            </div>
          );
        })(), document.body)}
      </nav>
      <section className="query-editor-panel">
        <div className="panel-header">
          <div className="editor-context">
            <div className="editor-title-line">
              <span className="eyebrow">GREMLIN EDITOR</span>
              <small className={`editor-save-status ${query !== savedContent ? "is-dirty" : "is-saved"}`}>
                {query !== savedContent
                  ? t("未保存更改", "Unsaved changes")
                  : scriptName
                    ? t("已保存", "Saved")
                    : t("空白标签页", "Blank tab")}
              </small>
            </div>
            <div className="editor-connection-line">
              <strong title={activeConnection?.name ?? t("未选择连接")}>
                {activeConnection?.name ?? t("未选择连接")}
              </strong>
              {activeConnection && (
                <small className="editor-connection-context">
                  {activeConnection.protocol.toUpperCase()} · {activeConnection.clientMode === "sessioned"
                    ? t("此标签页独立会话", "Private tab session")
                    : t("独立请求", "Isolated requests")}
                </small>
              )}
            </div>
          </div>
          <div className="editor-actions">
            <div className="editor-utilities" aria-label={t("编辑器工具", "Editor tools")}>
              <button type="button" onClick={() => void openScript()} title={t("打开 Gremlin 脚本", "Open Gremlin script")}>
                <FolderOpen size={16} />
                <span>{t("打开", "Open")}</span>
              </button>
              <button type="button" onClick={() => void saveScript()} disabled={!query.trim()} title={`${t("保存 Gremlin 脚本", "Save Gremlin script")} · ${shortcutLabel(settings.keyboardShortcuts.saveQuery)}`}>
                <FileCode2 size={16} />
                <span>{t("保存", "Save")}</span>
              </button>
              <button
                type="button"
                className={`${bindingsEnabled || timeoutMsOverride > 0 ? "is-active" : ""} ${parametersOpen ? "is-open" : ""}`.trim()}
                onClick={() => { setParametersOpen((value) => !value); setFavoritesOpen(false); setSuggestionsOpen(false); }}
                title={timeoutMsOverride > 0
                  ? t(`当前标签页超时：${timeoutMsOverride} ms`, `Current tab timeout: ${timeoutMsOverride} ms`)
                  : bindingsEnabled
                    ? t("参数绑定已启用，点击打开配置", "Bindings enabled; open configuration")
                    : t("打开查询参数与临时超时", "Open query parameters and temporary timeout")}
              >
                <SlidersHorizontal size={16} />
                <span>{t("参数", "Parameters")}</span>
                {(bindingsEnabled || timeoutMsOverride > 0) && <i className="parameters-live-dot" aria-hidden="true" />}
              </button>
              <button
                type="button"
                className={favoritesOpen ? "is-active" : ""}
                onClick={() => {
                  if (!favoritesOpen && query.trim()) openSnippetPanel(selectedQuery);
                  else setFavoritesOpen((value) => !value);
                  setParametersOpen(false); setSuggestionsOpen(false);
                }}
                title={t("保存或打开 Snippet", "Save or open Snippets")}
              >
                <Star size={16} />
                <span>Snippet</span>
              </button>
              <button
                type="button"
                className={readOnly ? "is-active" : ""}
                onClick={() => setReadOnly(!readOnly)}
                title={readOnly ? t("只读保护已启用", "Read-only protection enabled") : t("启用只读保护", "Enable read-only protection")}
              >
                <ShieldCheck size={16} />
                <span>{t("只读", "Read only")}</span>
              </button>
              <button
                type="button"
                disabled={!query.trim() || queryState.status === "loading"}
                onClick={formatEditorQuery}
                title={`${t("格式化 Gremlin 查询", "Format Gremlin query")} · ${shortcutLabel(settings.keyboardShortcuts.formatQuery)}`}
              >
                <AlignLeft size={16} />
                <span>{t("格式化", "Format")}</span>
              </button>
              <button
                type="button"
                className={`${transactionPanelOpen ? "is-active" : ""} ${transactionActive ? "has-transaction" : ""}`.trim()}
                onClick={() => {
                  setTransactionPanelOpen((value) => !value);
                  setParametersOpen(false);
                  setFavoritesOpen(false);
                  setSuggestionsOpen(false);
                }}
                title={activeConnection?.clientMode === "sessioned"
                  ? t("管理当前标签页事务", "Manage the current tab transaction")
                  : t("事务需要 Sessioned WS/WSS 连接", "Transactions require a sessioned WS/WSS connection")}
              >
                {transactionActive ? <CheckCircle2 size={16} /> : <CircleDot size={16} />}
                <span>{transactionActive ? t("事务中", "In transaction") : t("事务", "Transaction")}</span>
              </button>
              <button
                type="button"
                disabled={!query.trim() || queryState.status === "loading" || compatibility.loading || explainRoute.status === "unavailable"}
                onClick={() => runEditorQuery(withTraversalAnalysis(selectedQuery.trim() || query, "explain"))}
                title={explainRoute.status === "unavailable"
                  ? t("当前服务端不支持 Explain 遍历诊断", "The server does not support Explain traversal diagnostics")
                  : t("Explain：查看遍历策略优化计划", "Explain traversal strategy optimization")}
              >
                <GitBranch size={16} />
                <span>Explain</span>
              </button>
              <button
                type="button"
                disabled={!query.trim() || queryState.status === "loading" || compatibility.loading || profileRoute.status === "unavailable"}
                onClick={() => runEditorQuery(withTraversalAnalysis(selectedQuery.trim() || query, "profile"))}
                title={profileRoute.status === "unavailable"
                  ? t("当前服务端不支持 Profile 遍历诊断", "The server does not support Profile traversal diagnostics")
                  : t("Profile：执行并分析每个 Step 的耗时", "Profile step execution time")}
              >
                <Activity size={16} />
                <span>Profile</span>
              </button>
            </div>
            <span className={`editor-metric ${hasExecutableSelection ? "is-selection" : ""}`}>
              {hasExecutableSelection
                ? t(
                    `已选择 ${selectedQuery.length} 个字符`,
                    `${selectedQuery.length} characters selected`,
                  )
                : t(`${query.split("\n").length} 行`, `${query.split("\n").length} lines`)}
            </span>
            {queryState.status === "loading" ? (
              <button
                type="button"
                className="button danger editor-stop"
                onClick={stopQuery}
                disabled={queryState.stopping}
              >
                {queryState.stopping ? (
                  <LoaderCircle className="spin" size={17} />
                ) : (
                  <Square size={15} fill="currentColor" />
                )}
                {queryState.stopping
                  ? t("正在停止", "Stopping")
                  : t("停止查询", "Stop query")}
                <kbd>{shortcutLabel(settings.keyboardShortcuts.stopQuery)}</kbd>
              </button>
            ) : (
              <button
                type="button"
                className="button primary"
                onClick={() => runEditorQuery()}
                disabled={!activeConnection}
              >
                <Play size={17} fill="currentColor" />
                {hasExecutableSelection
                  ? t("运行选中内容", "Run selection")
                  : t("运行查询", "Run query")}
                <kbd>{shortcutLabel(settings.keyboardShortcuts.runQuery)}</kbd>
              </button>
            )}
          </div>
        </div>
        {transactionPanelOpen && (
          <aside className="editor-tool-popover transaction-popover">
            <header>
              <div>
                <span className="eyebrow">SESSION TRANSACTION</span>
                <strong>{t("标签页事务", "Tab transaction")}</strong>
              </div>
              <button type="button" onClick={() => setTransactionPanelOpen(false)} aria-label={t("关闭事务面板", "Close transaction panel")}>
                <X size={16} />
              </button>
            </header>
            {activeConnection?.clientMode === "sessioned" ? (
              <div className="transaction-content">
                <div className={`transaction-status ${transactionActive ? "is-open" : ""}`}>
                  <span aria-hidden="true" />
                  <div>
                    <small>{t("当前状态", "Current state")}</small>
                    <strong>{transactionActive
                      ? t("事务已开启", "Transaction open")
                      : t("未开启 · 下次查询自动开启", "Closed · the next query opens one automatically")}</strong>
                  </div>
                  <code>{activeConnection.name}</code>
                </div>
                <p>{t(
                  "事务只属于当前标签页。提交或回滚后不会立即重开；下一条图查询会按 JanusGraph 自动事务机制开启新事务，也可以立即手动开启。",
                  "The transaction belongs to this tab. Commit or rollback does not reopen it immediately; the next graph query starts a new JanusGraph transaction, or you can begin one now.",
                )}</p>
                <div className="transaction-actions">
                  <button
                    type="button"
                    className="button primary"
                    disabled={transactionBusy !== null || transactionActive}
                    onClick={() => void beginTransaction()}
                  >
                    {transactionBusy === "begin" ? <LoaderCircle className="spin" size={17} /> : <Play size={16} fill="currentColor" />}
                    {t("立即开启", "Begin now")}
                    <kbd>{shortcutLabel(settings.keyboardShortcuts.beginTransaction)}</kbd>
                  </button>
                  <button
                    type="button"
                    className="button secondary"
                    disabled={transactionBusy !== null || !transactionActive}
                    onClick={() => void finishTransaction("commit")}
                  >
                    {transactionBusy === "commit" ? <LoaderCircle className="spin" size={17} /> : <CheckCircle2 size={17} />}
                    {t("提交", "Commit")}
                    <kbd>{shortcutLabel(settings.keyboardShortcuts.commitTransaction)}</kbd>
                  </button>
                  <button
                    type="button"
                    className="button secondary transaction-rollback"
                    disabled={transactionBusy !== null || !transactionActive}
                    onClick={() => void finishTransaction("rollback")}
                  >
                    {transactionBusy === "rollback" ? <LoaderCircle className="spin" size={17} /> : <RotateCcw size={17} />}
                    {t("回滚", "Rollback")}
                    <kbd>{shortcutLabel(settings.keyboardShortcuts.rollbackTransaction)}</kbd>
                  </button>
                </div>
              </div>
            ) : (
              <div className="transaction-unavailable">
                <CircleDot size={24} />
                <strong>{t("当前连接不能保留跨查询事务", "This connection cannot retain a transaction across queries")}</strong>
                <p>{t(
                  "请在连接管理中把 Client 模式改为 Sessioned，并使用 WS/WSS 协议。Sessionless 和 HTTP(S) 每次查询都是独立请求。",
                  "Set Client mode to Sessioned with WS/WSS in Connections. Sessionless and HTTP(S) execute isolated requests.",
                )}</p>
              </div>
            )}
          </aside>
        )}
        {parametersOpen && (
          <aside className="editor-tool-popover parameters-popover">
            <header>
              <div>
                <span className="eyebrow">QUERY PARAMETERS</span>
                <strong>{t("查询参数", "Query parameters")}</strong>
              </div>
              <button type="button" onClick={() => setParametersOpen(false)} aria-label={t("关闭参数", "Close parameters")}><X size={16} /></button>
            </header>
            <button
              type="button"
              role="switch"
              aria-checked={bindingsEnabled}
              className={`parameters-enable ${bindingsEnabled ? "is-on" : ""}`}
              onClick={() => {
                if (!bindingsEnabled) {
                  try {
                    parseBindings(bindingsText);
                    setBindingsError("");
                  } catch (error) {
                    setBindingsError(errorMessage(error));
                    return;
                  }
                }
                setBindingsEnabled(!bindingsEnabled);
              }}
            >
              <span className="parameters-enable-icon">
                {bindingsEnabled ? <Check size={17} /> : <Braces size={17} />}
              </span>
              <span>
                <strong>{bindingsEnabled
                  ? t("参数绑定已启用", "Parameter bindings enabled")
                  : t("启用参数绑定", "Enable parameter bindings")}</strong>
                <small>{bindingsEnabled
                  ? t("运行查询时会发送下方 JSON；关闭后不发送任何绑定值", "The JSON below is sent with each query; disable to send no bindings")
                  : t("当前查询仅发送 Gremlin 文本，不会使用下方 JSON", "Only Gremlin text is sent; the JSON below is currently inactive")}</small>
              </span>
              <span className="switch" aria-hidden="true"><span /></span>
            </button>
            <div className="parameters-intro">
              <Braces size={20} />
              <div>
                <strong>{t("安全参数化查询", "Safe parameterized queries")}</strong>
                <p>{t("输入 JSON 对象，在查询中直接使用对应变量名，避免把动态值拼接进 Gremlin。", "Enter a JSON object and reference its keys in Gremlin instead of interpolating dynamic values.")}</p>
              </div>
            </div>
            <section className={`query-timeout-override${timeoutMsOverride > 0 ? " is-active" : ""}`}>
              <span className="parameters-enable-icon"><TimerReset size={17} /></span>
              <div>
                <strong>{t("标签页临时查询超时", "Temporary tab query timeout")}</strong>
                <small>{timeoutMsOverride > 0
                  ? t("覆盖连接配置，并同时传给 Gremlin Server", "Overrides the connection setting and is sent to Gremlin Server")
                  : t(`跟随连接配置：${activeConnection?.queryTimeoutMs ?? 0} ms`, `Using connection setting: ${activeConnection?.queryTimeoutMs ?? 0} ms`)}</small>
              </div>
              <input
                type="number"
                min={500}
                max={86_400_000}
                step={500}
                value={timeoutMsOverride || activeConnection?.queryTimeoutMs || 60_000}
                disabled={timeoutMsOverride === 0}
                onChange={(event) => {
                  const value = Math.max(500, Math.min(86_400_000, Number(event.target.value) || 500));
                  setTimeoutMsOverride(Math.round(value));
                }}
                aria-label={t("临时查询超时毫秒数", "Temporary query timeout in milliseconds")}
              />
              <button type="button" className="button text" onClick={() => setTimeoutMsOverride(
                timeoutMsOverride > 0 ? 0 : activeConnection?.queryTimeoutMs || 60_000,
              )}>
                {timeoutMsOverride > 0 ? t("跟随连接", "Use connection") : t("启用覆盖", "Enable override")}
              </button>
            </section>
            <label className="parameters-editor">
              <span><b>JSON</b><small>{t("对象键将作为查询绑定变量", "Object keys become query bindings")}</small></span>
              <textarea
                value={bindingsText}
                onChange={(event) => {
                  setBindingsText(event.target.value);
                  setBindingsError("");
                }}
                spellCheck={false}
                aria-label={t("JSON 查询参数", "JSON query parameters")}
                placeholder={'{\n  "vertexId": 123,\n  "limit": 20\n}'}
              />
            </label>
            {bindingsError && (
              <div className="parameters-error" role="alert">
                <AlertTriangle size={16} />
                <span>{bindingsError}</span>
              </div>
            )}
            <div className="parameters-usage">
              <div>
                <small>1 · {t("定义绑定变量", "Define bindings")}</small>
                <code>{'{ "vertexId": 123, "limit": 20 }'}</code>
              </div>
              <span aria-hidden="true">→</span>
              <div>
                <small>2 · {t("在 Gremlin 中直接使用键名", "Use keys directly in Gremlin")}</small>
                <code>g.V(vertexId).limit(limit)</code>
              </div>
            </div>
            <footer>
              <span>
                <small>{bindingsEnabled ? t("执行状态", "Execution status") : t("当前未启用", "Currently disabled")}</small>
                <code>{bindingsEnabled
                  ? t("变量名不加引号，值由驱动安全传递", "Do not quote variable names; values are sent safely by the driver")
                  : t("参数将保留在标签页中，但不会随查询发送", "Bindings stay in this tab but are not sent with queries")}</code>
              </span>
              <div>
                <button type="button" className="button text" onClick={() => {
                  setBindingsText("{}");
                  setBindingsError("");
                }}>{t("清空参数", "Clear bindings")}</button>
                <button type="button" className="button secondary" onClick={() => {
                  try {
                    parseBindings(bindingsText);
                    setBindingsError("");
                    notify({ tone: "success", message: t("参数 JSON 有效", "Bindings JSON is valid") });
                  } catch (error) {
                    setBindingsError(errorMessage(error));
                    notify({ tone: "error", message: errorMessage(error) });
                  }
                }}>{t("验证 JSON", "Validate JSON")}</button>
              </div>
            </footer>
          </aside>
        )}
        {favoritesOpen && (
          <aside className="editor-tool-popover favorites-popover">
            <header>
              <div>
                <span className="eyebrow">QUERY SNIPPETS</span>
                <strong>{t("保存为 Snippet", "Save as Snippet")}</strong>
              </div>
              <button type="button" onClick={() => setFavoritesOpen(false)} aria-label={t("关闭 Snippet 面板", "Close Snippet panel")}><X size={16} /></button>
            </header>
            <form className="saved-query-create" onSubmit={(event) => { event.preventDefault(); void addSavedQuery(); }}>
              <label>
                <span>{t("Snippet 名称", "Snippet name")}</span>
                <input
                  value={savedQueryName}
                  onChange={(event) => setSavedQueryName(event.target.value)}
                  maxLength={80}
                  placeholder={tabs.find((tab) => tab.id === activeTabId)?.title || t("为查询命名", "Name this query")}
                  aria-label={t("Snippet 名称", "Snippet name")}
                />
              </label>
              <button type="submit" className="save-current-query" disabled={!(snippetQueryDraft.trim() || query.trim())}>
                <Plus size={16} />
                {t("保存 Snippet", "Save Snippet")}
              </button>
            </form>
            <div className="saved-query-list">
              {savedQueriesLoading ? (
                <p>{t("正在加载 Snippet…", "Loading Snippets…")}</p>
              ) : savedQueries.length === 0 ? (
                <p>{t("尚无 Snippet", "No Snippets yet")}</p>
              ) : savedQueries.map((entry) => (
                <div key={entry.id}>
                  {renamingSavedQueryId === entry.id ? (
                    <input
                      className="saved-query-rename"
                      value={renamingSavedQueryName}
                      autoFocus
                      maxLength={80}
                      onChange={(event) => setRenamingSavedQueryName(event.target.value)}
                      onBlur={() => commitSavedQueryRename(entry.id)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") event.currentTarget.blur();
                        if (event.key === "Escape") setRenamingSavedQueryId(null);
                      }}
                      aria-label={t("重命名 Snippet", "Rename Snippet")}
                    />
                  ) : (
                    <button type="button" onClick={() => { onOpenSnippet(entry); setFavoritesOpen(false); }}>
                      <strong>{entry.name}</strong>
                      <code>{entry.query}</code>
                    </button>
                  )}
                  <button type="button" onClick={() => {
                    setRenamingSavedQueryId(entry.id);
                    setRenamingSavedQueryName(entry.name);
                  }} aria-label={t(`重命名 ${entry.name}`, `Rename ${entry.name}`)}><Edit3 size={15} /></button>
                  <button type="button" onClick={() => void removeSavedQuery(entry.id)} aria-label={t(`删除 ${entry.name}`, `Delete ${entry.name}`)}><Trash2 size={15} /></button>
                </div>
              ))}
            </div>
            <button type="button" className="saved-query-manage" onClick={onOpenQueryAssets}>
              <Layers3 size={16} />{t("管理全部查询资产", "Manage all query assets")}
            </button>
          </aside>
        )}
        <div className="query-editor-shell">
          <GremlinEditor
            modelId={activeTabId}
            value={query}
            onChange={setQuery}
            onSelectionChange={setSelectedQuery}
            onFocus={() => {
              if (settings.querySuggestionsEnabled) setSuggestionsOpen(true);
            }}
            onSuggestionVisibilityChange={setMonacoSuggestionsOpen}
            onRun={(selectionValue) => {
              if (queryState.status !== "loading") runEditorQuery(selectionValue);
            }}
            onStop={() => {
              if (queryState.status === "loading") stopQuery();
            }}
            onFormat={formatEditorQuery}
            onExplain={(selectionValue) => runEditorQuery(withTraversalAnalysis(selectionValue?.trim() || query, "explain"))}
            onProfile={(selectionValue) => runEditorQuery(withTraversalAnalysis(selectionValue?.trim() || query, "profile"))}
            onSaveSnippet={openSnippetPanel}
            canRun={Boolean(activeConnection) && queryState.status !== "loading"}
            runShortcut={settings.keyboardShortcuts.runQuery}
            stopShortcut={settings.keyboardShortcuts.stopQuery}
            formatShortcut={settings.keyboardShortcuts.formatQuery}
            findReplaceShortcut={settings.keyboardShortcuts.findReplace}
            fontSize={settings.editorFontSize}
            readOnly={queryState.status === "loading"}
            diagnosticMessage={queryState.status === "error" ? queryState.message : undefined}
            schemaCatalog={schemaCatalog}
            ariaLabel={t("Gremlin 查询语句", "Gremlin query")}
            placeholder={t(
              "选择连接后输入 Gremlin，例如：g.V().limit(20).elementMap()",
              "Select a connection and enter Gremlin, for example: g.V().limit(20).elementMap()",
            )}
          />
          {activeConnection && (
            <span className="traversal-alias">
              g
              <MoveRight
                className="traversal-alias-arrow"
                size={16}
                strokeWidth={1.5}
                aria-hidden="true"
              />
              {activeConnection.traversalSource}
            </span>
          )}
          <QueryHints
            query={query}
            history={history}
            visible={settings.querySuggestionsEnabled && suggestionsOpen && !monacoSuggestionsOpen && !parametersOpen && !favoritesOpen && !transactionPanelOpen}
            onClose={() => setSuggestionsOpen(false)}
            onApply={(suggestion) =>
              setQuery(
                suggestion.mode === "replace"
                  ? suggestion.value
                  : appendQuerySuggestion(query, suggestion.value),
              )
            }
          />
        </div>
      </section>

      <div
        className="query-panel-resizer"
        role="separator"
        aria-label={t("调整编辑器与查询结果高度", "Resize editor and query result")}
        aria-orientation="horizontal"
        aria-valuemin={24}
        aria-valuemax={72}
        aria-valuenow={Math.round(editorPanePercent)}
        tabIndex={0}
        onPointerDown={beginPanelResize}
        onDoubleClick={() => {
          setEditorPanePercent(42);
          localStorage.setItem("janusgraph.queryEditorPanePercent.v1", "42");
        }}
        onKeyDown={(event) => {
          if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
          event.preventDefault();
          const next = Math.min(72, Math.max(24, editorPanePercent + (event.key === "ArrowDown" ? 2 : -2)));
          setEditorPanePercent(next);
          localStorage.setItem("janusgraph.queryEditorPanePercent.v1", String(next));
        }}
      ><span /></div>

      <section className="result-panel">
        <div className="result-toolbar">
          <div>
            <span className="eyebrow">QUERY RESULT</span>
            {result ? (
              <strong>
                {scalarResult
                  ? `${t("标量结果", "Scalar result")} · ${result.durationMs} ms`
                  : `${result.totalCount.toLocaleString()} ${t("条", "rows")} · ${result.durationMs} ms${result.truncated ? ` · ${result.items.length.toLocaleString()} ${t("条已载入", "rows loaded")}` : ""}`}
              </strong>
            ) : (
              <strong>{t("等待执行")}</strong>
            )}
          </div>
          <div className="result-toolbar-actions">
            <div className="result-modes" aria-label={t("结果显示方式")}>
              {!analysisKind && <button
              type="button"
              className={mode === "graph" ? "is-active" : ""}
              onClick={() => setMode("graph")}
            >
              <Waypoints size={17} />
              {t("拓扑")}
              </button>}
              {!analysisKind && <button
              type="button"
              className={mode === "table" ? "is-active" : ""}
              onClick={() => setMode("table")}
            >
              {scalarResult ? <Hash size={17} /> : <Table2 size={17} />}
              {scalarResult ? t("单值", "Single value") : t("表格")}
              </button>}
              <button
              type="button"
              className={mode === "json" ? "is-active" : ""}
              onClick={() => setMode("json")}
            >
              <Braces size={17} />
              JSON
              </button>
              <button
                type="button"
                className={mode === "raw" && (!analysisKind || diagnosticView === "diagnostics") ? "is-active" : ""}
                onClick={() => { setMode("raw"); setDiagnosticView("diagnostics"); }}
                title={t("以 Gremlin Console 行格式查看结果", "Inspect results in Gremlin Console line format")}
              >
                {analysisKind === "profile" ? <Activity size={17} /> : analysisKind === "explain" ? <GitBranch size={17} /> : <Code2 size={17} />}
                {analysisKind ? t("诊断", "Diagnostics") : t("控制台", "Console")}
              </button>
              {analysisKind && (
                <button
                  type="button"
                  className={mode === "raw" && diagnosticView === "console" ? "is-active" : ""}
                  onClick={() => { setMode("raw"); setDiagnosticView("console"); }}
                  title={t("查看 Explain/Profile 的 Gremlin Console 原始输出", "View the raw Gremlin Console output for Explain/Profile")}
                >
                  <Code2 size={17} />
                  {t("控制台", "Console")}
                </button>
              )}
              <button
                type="button"
                className={mode === "source" ? "is-active" : ""}
                onClick={() => setMode("source")}
                title={t("查看服务器返回的完整原始结构", "Inspect the complete server response structure")}
              >
                <FileJson size={17} />
                {t("原始", "Original")}
              </button>
            </div>
            {result && (
              <div className="query-export-actions" aria-label={t("导出查询结果")}>
                <button
                  type="button"
                  onClick={() => void exportResult("json")}
                  title={t("导出 JSON", "Export JSON")}
                >
                  <FileJson size={17} />
                  JSON
                </button>
                <button
                  type="button"
                  onClick={() => void exportResult("jsonl")}
                  title={t("导出 JSON Lines", "Export JSON Lines")}
                >
                  <FileJson size={17} />
                  JSONL
                </button>
                <button
                  type="button"
                  onClick={() => void exportResult("csv")}
                  title={t("导出 CSV", "Export CSV")}
                >
                  <Download size={17} />
                  CSV
                </button>
                {result.truncated && (
                  <button
                    type="button"
                    disabled={fullExporting}
                    onClick={() => void exportCompleteResult()}
                    title={t(
                      "重新执行当前只读查询，并将全部结果流式写入 JSON Lines 文件",
                      "Re-run the current read-only query and stream every result to a JSON Lines file",
                    )}
                  >
                    {fullExporting ? <LoaderCircle className="spin" size={17} /> : <Database size={17} />}
                    {t("完整结果", "All rows")}
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
        <div className="result-body">
          {queryState.status === "idle" && (
            <EmptyState
              icon={<TerminalSquare size={31} />}
              title={t("尚未执行查询")}
              description={
                activeConnection
                  ? t(
                      "输入 Gremlin 语句并运行，真实结果会显示在这里。",
                      "Enter a Gremlin query to display live server results here.",
                    )
                  : t(
                      "请先在连接管理中添加并选择一个 JanusGraph 连接。",
                      "Add and select a JanusGraph connection first.",
                    )
              }
            />
          )}
          {queryState.status === "loading" && (
            <div className="loading-state">
              <LoaderCircle className="spin" size={28} />
              <strong>{t("正在等待 JanusGraph 返回结果")}</strong>
              <span>{t("查询会按照连接配置中的超时时间自动终止")}</span>
            </div>
          )}
          {queryState.status === "error" && (
            <EmptyState
              icon={<AlertTriangle size={31} />}
              title={t("查询执行失败")}
              description={queryState.message}
              action={
                <button
                  type="button"
                  className="button secondary"
                  onClick={() => runEditorQuery()}
                >
                  <RefreshCw size={17} />
                  {t("重试")}
                </button>
              }
            />
          )}
          {queryState.status === "cancelled" && (
            <EmptyState
              icon={<Square size={27} fill="currentColor" />}
              title={t("查询已停止", "Query stopped")}
              description={queryState.message}
              action={
                <button
                  type="button"
                  className="button secondary"
                  onClick={() => runEditorQuery()}
                >
                  <RefreshCw size={17} />
                  {t("重新运行", "Run again")}
                </button>
              }
            />
          )}
          {result && mode === "table" && <TableResult rows={tableRows} rawItems={result.items} scalar={scalarResult} />}
          {result && mode === "json" && (
            <pre className="json-result">
              {JSON.stringify(structuredItems, null, 2)}
            </pre>
          )}
          {result && mode === "raw" && (
            <div className={`console-result-layout ${traversalDiagnostic && diagnosticView === "diagnostics" ? "has-diagnostics" : ""}`}>
              {traversalDiagnostic && diagnosticView === "diagnostics" && <TraversalDiagnosticsPanel diagnostic={traversalDiagnostic} />}
              {(!traversalDiagnostic || diagnosticView === "console") && <div className="raw-result">
                <header>
                  <div>
                    <span className="eyebrow">GREMLIN CONSOLE</span>
                    <strong>Gremlin Console</strong>
                  </div>
                  <small>{t("每条结果使用 ==> 前缀，Map 以 key=value 形式展示。", "Each result uses the ==> prefix and maps are rendered as key=value pairs.")}</small>
                  <button type="button" onClick={() => {
                    void navigator.clipboard.writeText(consoleOutput).then(() => {
                      notify({ tone: "success", message: t("控制台输出已复制", "Console output copied") });
                    }).catch((error) => {
                      notify({ tone: "error", message: errorMessage(error) });
                    });
                  }}>
                    <Copy size={15} />
                    {t("复制控制台输出", "Copy console output")}
                  </button>
                </header>
                <pre>{consoleOutput}</pre>
              </div>}
            </div>
          )}
          {result && mode === "source" && (
            <div className="raw-result source-result">
              <header>
                <div>
                  <span className="eyebrow">SERVER RESPONSE</span>
                  <strong>{t("原始结果结构", "Original result structure")}</strong>
                </div>
                <small>{t("保留驱动层返回的完整字段、类型包装和属性元数据。", "Preserves every field, type wrapper, and property metadata returned by the driver.")}</small>
                <button type="button" onClick={() => {
                  void navigator.clipboard.writeText(JSON.stringify(result.items, null, 2)).then(() => {
                    notify({ tone: "success", message: t("原始结果已复制", "Original result copied") });
                  }).catch((error) => notify({ tone: "error", message: errorMessage(error) }));
                }}>
                  <Copy size={15} />
                  {t("复制原始结果", "Copy original result")}
                </button>
              </header>
              <pre>{JSON.stringify(result.items, null, 2)}</pre>
            </div>
          )}
          {result && mode === "graph" && (
            <div className={`graph-layout ${selection ? "has-inspector" : ""}`}>
              <InteractiveGraph
                model={graph}
                selection={selection}
                onSelect={selectGraphElement}
                nodeLimit={settings.graphNodeLimit}
                edgeLimit={settings.graphEdgeLimit}
                showLabels={settings.graphShowLabels}
                showGrid={settings.graphShowGrid}
                layoutMode={settings.graphLayout}
                layoutConfiguration={settings.graphLayoutConfiguration}
                onLayoutModeChange={(graphLayout) =>
                  onSettingsChange({ ...settings, graphLayout })
                }
                vertexLabelFields={settings.graphVertexLabelFields}
                edgeLabelFields={settings.graphEdgeLabelFields}
                detailStatus={selectionDetail.status}
                detailError={
                  selectionDetail.status === "error"
                    ? selectionDetail.message
                    : ""
                }
                onExportComplete={(path) => notify({
                  tone: "success",
                  message: t(`拓扑图已保存到 ${path}`, `Graph saved to ${path}`),
                })}
                onExportError={(message) => notify({ tone: "error", message })}
              />
              <ElementInspector
                selection={selection}
                detailState={selectionDetail}
                onClose={() => selectGraphElement(null)}
              />
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
