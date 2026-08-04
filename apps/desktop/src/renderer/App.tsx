import { connectionEndpoint } from "@janusgraph/application";
import type {
  ConnectionSummary,
  ConnectionTestReport,
  PickedDataFile,
  QueryExecutionResult,
  QueryHistoryEntry,
  SaveConnectionInput,
  SchemaJob,
  SecurityStorageStatus,
} from "@janusgraph/domain";
import {
  Activity,
  AlignLeft,
  AlertTriangle,
  Braces,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleDot,
  Clock3,
  Code2,
  Copy,
  Database,
  Download,
  Edit3,
  Eye,
  EyeOff,
  FileCode2,
  FileJson,
  FileUp,
  FolderOpen,
  GitBranch,
  History,
  KeyRound,
  Keyboard,
  Layers3,
  Languages,
  LockKeyhole,
  LoaderCircle,
  Moon,
  MoreHorizontal,
  Network,
  Play,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Server,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Square,
  Star,
  Sun,
  Table2,
  TerminalSquare,
  Trash2,
  Upload,
  Waypoints,
  X,
  Zap,
} from "lucide-react";
import {
  type FormEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import {
  parseGraphArchive,
  rowsToCsv,
  type GraphArchive,
} from "./lib/data-files";
import {
  applySettings,
  DEFAULT_SETTINGS,
  loadSettings,
  saveSettings,
  type KeyboardShortcuts,
  type ShortcutAction,
  type GraphLayoutConfiguration,
  type AppSettings,
} from "./lib/settings";
import {
  localizedLanguageOptions,
  LocaleProvider,
  translate,
  useLocale,
  useTranslate,
} from "./lib/i18n";
import { InteractiveGraph } from "./components/InteractiveGraph";
import { GremlinEditor } from "./components/GremlinEditor";
import { DataGrid } from "./components/DataGrid";
import { SelectControl } from "./components/SelectControl";
import {
  EMPTY_SCHEMA_CATALOG,
  schemaCatalogFromRows,
  schemaRowsFromItems,
  type GremlinSchemaCatalog,
} from "./lib/gremlin-completion";
import { formatGremlin } from "./lib/gremlin-format";
import {
  buildGraphModel,
  buildTableRows,
  decodeGraphValue,
  gremlinConsoleOutput,
  mergeGraphModels,
  orderedInspectorEntries,
  printableValue,
  structuredJsonItems,
  type GraphEdgeModel,
  type GraphModel,
  type GraphNodeModel,
  type ResultRow,
} from "./lib/result-model";

type ViewId =
  | "query"
  | "connections"
  | "history"
  | "schema"
  | "transfer"
  | "settings";
type ResultMode = "graph" | "table" | "json" | "raw" | "source";
type Selection =
  | { kind: "node"; value: GraphNodeModel }
  | { kind: "edge"; value: GraphEdgeModel }
  | null;

type SelectionDetailState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string };

type QueryState =
  | { status: "idle" }
  | { status: "loading"; executionId?: string; stopping?: boolean }
  | { status: "cancelled"; message: string }
  | { status: "error"; message: string }
  | { status: "success"; result: QueryExecutionResult };

type QueryTabState = {
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

type SavedQuery = {
  id: string;
  name: string;
  query: string;
  bindingsText: string;
  createdAt: string;
};

type ToastState = {
  tone: "success" | "error" | "info";
  message: string;
};

const EMPTY_GRAPH_MODEL: GraphModel = { nodes: [], edges: [] };
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

function createQueryTab(
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

function loadQueryWorkspace(
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

function saveQueryWorkspace(
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

function loadSavedQueries(): SavedQuery[] {
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

function saveSavedQueries(entries: SavedQuery[]) {
  localStorage.setItem(SAVED_QUERIES_STORAGE_KEY, JSON.stringify(entries.slice(0, 200)));
}

function parseBindings(bindingsText: string): Record<string, unknown> {
  const value = JSON.parse(bindingsText || "{}") as unknown;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("查询参数必须是 JSON 对象");
  }
  return value as Record<string, unknown>;
}

function gremlinFileName(title: string): string {
  const safeTitle = title.trim().replace(/[\\/:*?"<>|]+/g, "-").replace(/\.+$/g, "") || "query";
  return /\.(?:gremlin|groovy)$/i.test(safeTitle) ? safeTitle : `${safeTitle}.gremlin`;
}

function tabTitleFromFileName(fileName: string): string {
  const title = fileName.replace(/\.(?:gremlin|groovy|grem)$/i, "").trim();
  return title || "query";
}

function isMutationQuery(query: string): boolean {
  const normalized = query
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/.*$/gm, " ")
    .replace(/'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"/g, "''");
  return /\.(?:addV|addE|mergeV|mergeE|property|drop|sideEffect|write)\s*\(|\.tx\s*\(\)|Management\s*\(/i.test(normalized);
}

function withTraversalAnalysis(query: string, step: "explain" | "profile") {
  const source = query.trim().replace(/;\s*$/, "");
  if (new RegExp(`\\.${step}\\(\\)\\.next\\(\\)\\.toString\\(\\)$`).test(source)) {
    return source;
  }
  const traversal = source.replace(/\.(?:toList|next|iterate)\s*\(\s*\)\s*$/, "");
  const analyzed = traversal.endsWith(`.${step}()`) ? traversal : `${traversal}.${step}()`;
  return `${analyzed}.next().toString()`;
}

function shortcutFromEvent(event: KeyboardEvent): string | null {
  const parts: string[] = [];
  if (event.metaKey || event.ctrlKey) parts.push("Mod");
  if (event.altKey) parts.push("Alt");
  if (event.shiftKey) parts.push("Shift");
  const key =
    event.code === "Space"
      ? "Space"
      : event.code === "BracketLeft" || event.code === "BracketRight"
        ? event.code
        : event.key.length === 1
          ? event.key.toUpperCase()
          : event.key;
  if (["Meta", "Control", "Alt", "Shift"].includes(key)) return null;
  if (parts.length === 0 && !/^F\d{1,2}$/.test(key)) return null;
  return [...parts, key].join("+");
}

function matchesShortcut(event: KeyboardEvent, shortcut: string): boolean {
  return shortcutFromEvent(event) === shortcut;
}

function shortcutLabel(shortcut: string): string {
  const isMac = navigator.platform.toLowerCase().includes("mac");
  return shortcut
    .replace("Mod", isMac ? "⌘" : "Ctrl")
    .replace("Alt", isMac ? "⌥" : "Alt")
    .replace("Shift", isMac ? "⇧" : "Shift")
    .replace("BracketLeft", "[")
    .replace("BracketRight", "]")
    .replaceAll("+", isMac ? " " : " + ");
}

function configuredPropertyFields(fields: string): string[] {
  return fields
    .split(",")
    .map((field) => field.trim())
    .filter(
      (field) =>
        field &&
        field !== "label" &&
        field !== "~label" &&
        field !== "id" &&
        field !== "~id",
    );
}

function hasDisplayProperty(
  entity: GraphNodeModel | GraphEdgeModel,
  fields: string[],
): boolean {
  return fields.some((field) => {
    const value = entity.properties[field];
    if (value === undefined || value === null) return false;
    if (typeof value === "string") return value.trim().length > 0;
    if (Array.isArray(value)) return value.length > 0;
    return true;
  });
}

const NAV_ITEMS: Array<{
  id: ViewId;
  label: string;
  description: string;
  icon: ReactNode;
}> = [
  {
    id: "query",
    label: "查询工作台",
    description: "执行 Gremlin 并查看结果",
    icon: <TerminalSquare size={19} />,
  },
  {
    id: "connections",
    label: "连接管理",
    description: "账号、协议与认证",
    icon: <Database size={19} />,
  },
  {
    id: "history",
    label: "执行历史",
    description: "本地查询记录",
    icon: <History size={19} />,
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
  {
    id: "settings",
    label: "偏好设置",
    description: "阅读与交互",
    icon: <Settings2 size={19} />,
  },
];

const EMPTY_CONNECTION: Omit<SaveConnectionInput, "id"> = {
  name: "",
  protocol: "ws",
  host: "127.0.0.1",
  port: 8182,
  path: "/gremlin",
  username: "",
  password: "",
  clientMode: "sessionless",
  traversalSource: "g",
  graphBinding: "graph",
  connectTimeoutMs: 10_000,
  queryTimeoutMs: 60_000,
  tlsRejectUnauthorized: true,
  enableCompression: false,
  customHeaders: "{}",
};

function formatDate(value: string, locale = "zh-CN"): string {
  return new Intl.DateTimeFormat(locale, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}

function errorMessage(error: unknown): string {
  if (!(error instanceof Error)) return "操作失败，请稍后重试";
  return error.message.replace(
    /^Error invoking remote method '[^']+': Error:\s*/,
    "",
  );
}

function safeIdentifier(value: string): string {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(value) ? value : "graph";
}

function stringLiteral(value: string): string {
  return JSON.stringify(value);
}

function connectionFromForm(
  form: HTMLFormElement,
  editing: ConnectionSummary | null,
): SaveConnectionInput {
  const data = new FormData(form);
  const password = String(data.get("password") ?? "");
  return {
    id: editing?.id,
    name: String(data.get("name") ?? "").trim(),
    protocol: String(data.get("protocol") ?? "ws") as SaveConnectionInput["protocol"],
    host: String(data.get("host") ?? "").trim(),
    port: Number(data.get("port")),
    path: String(data.get("path") ?? "").trim(),
    username: String(data.get("username") ?? ""),
    password: editing?.hasPassword && password === "" ? undefined : password,
    clientMode: String(
      data.get("clientMode") ?? "sessionless",
    ) as SaveConnectionInput["clientMode"],
    traversalSource: String(data.get("traversalSource") ?? "").trim(),
    graphBinding: String(data.get("graphBinding") ?? "").trim(),
    connectTimeoutMs: Number(data.get("connectTimeoutMs")),
    queryTimeoutMs: Number(data.get("queryTimeoutMs")),
    tlsRejectUnauthorized: data.get("tlsRejectUnauthorized") === "on",
    enableCompression: data.get("enableCompression") === "on",
    customHeaders: String(data.get("customHeaders") ?? "{}").trim() || "{}",
  };
}

function IconButton({
  label,
  children,
  onClick,
  disabled = false,
  tone = "default",
}: {
  label: string;
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  tone?: "default" | "danger";
}) {
  return (
    <button
      type="button"
      className={`icon-button ${tone === "danger" ? "is-danger" : ""}`}
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}

function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <div className="empty-state-icon">{icon}</div>
      <strong>{title}</strong>
      <p>{description}</p>
      {action}
    </div>
  );
}

function Modal({
  title,
  eyebrow,
  onClose,
  children,
  width = "wide",
}: {
  title: string;
  eyebrow: string;
  onClose: () => void;
  children: ReactNode;
  width?: "narrow" | "wide";
}) {
  const t = useTranslate();
  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [onClose]);

  return (
    <div className="modal-layer" role="presentation" onMouseDown={onClose}>
      <section
        className={`modal-card modal-${width}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="modal-header">
          <div>
            <span className="eyebrow">{eyebrow}</span>
            <h2 id="modal-title">{title}</h2>
          </div>
          <IconButton label={t("关闭", "Close")} onClick={onClose}>
            <X size={19} />
          </IconButton>
        </header>
        {children}
      </section>
    </div>
  );
}

function ConfirmDialog({
  title,
  description,
  confirmLabel,
  onCancel,
  onConfirm,
}: {
  title: string;
  description: string;
  confirmLabel: string;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
}) {
  const t = useTranslate();
  const [busy, setBusy] = useState(false);
  return (
    <Modal title={title} eyebrow="CONFIRM ACTION" onClose={onCancel} width="narrow">
      <div className="confirm-content">
        <AlertTriangle size={28} />
        <p>{description}</p>
      </div>
      <footer className="modal-actions">
        <button type="button" className="button secondary" onClick={onCancel}>
          {t("取消", "Cancel")}
        </button>
        <button
          type="button"
          className="button danger"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            await onConfirm();
            setBusy(false);
          }}
        >
          {busy ? <LoaderCircle className="spin" size={17} /> : <Trash2 size={17} />}
          {confirmLabel}
        </button>
      </footer>
    </Modal>
  );
}

function ConnectionDialog({
  editing,
  onClose,
  onSaved,
}: {
  editing: ConnectionSummary | null;
  onClose: () => void;
  onSaved: (connection: ConnectionSummary) => void;
}) {
  const t = useTranslate();
  const formRef = useRef<HTMLFormElement>(null);
  const [busy, setBusy] = useState<"test" | "save" | null>(null);
  const [message, setMessage] = useState<{
    tone: "success" | "error";
    text: string;
  } | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const defaults = editing ?? EMPTY_CONNECTION;

  const readInput = (): SaveConnectionInput | null => {
    const form = formRef.current;
    if (!form?.reportValidity()) return null;
    return connectionFromForm(form, editing);
  };

  const test = async () => {
    const input = readInput();
    if (!input || !window.janusGraphDesktop) return;
    setBusy("test");
    setMessage(null);
    try {
      const report = await window.janusGraphDesktop.connections.test(input);
      setMessage({
        tone: report.success ? "success" : "error",
        text: report.success
          ? `${report.message}，延迟 ${report.latencyMs} ms`
          : report.message,
      });
    } catch (error) {
      setMessage({ tone: "error", text: errorMessage(error) });
    } finally {
      setBusy(null);
    }
  };

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const input = readInput();
    if (!input || !window.janusGraphDesktop) return;
    setBusy("save");
    setMessage(null);
    try {
      const saved = await window.janusGraphDesktop.connections.save(input);
      onSaved(saved);
    } catch (error) {
      setMessage({ tone: "error", text: errorMessage(error) });
    } finally {
      setBusy(null);
    }
  };

  return (
    <Modal
      title={
        editing
          ? t("编辑连接", "Edit Connection")
          : t("添加 JanusGraph 连接", "Add JanusGraph Connection")
      }
      eyebrow="CONNECTION PROFILE"
      onClose={onClose}
    >
      <form ref={formRef} className="connection-form" onSubmit={save}>
        <div className="form-grid">
          <label className="field field-span-2">
            <span>{t("连接名称", "Connection name")}</span>
            <input name="name" defaultValue={defaults.name} required maxLength={80} />
          </label>
          <label className="field">
            <span>{t("协议", "Protocol")}</span>
            <SelectControl
              name="protocol"
              ariaLabel={t("协议", "Protocol")}
              defaultValue={defaults.protocol}
              options={[
                { value: "ws", label: "WS", description: "Gremlin WebSocket" },
                { value: "wss", label: "WSS", description: "TLS WebSocket" },
                { value: "http", label: "HTTP", description: "HTTP endpoint" },
                { value: "https", label: "HTTPS", description: "TLS HTTP endpoint" },
              ]}
            />
          </label>
          <label className="field">
            <span>{t("端口", "Port")}</span>
            <input
              name="port"
              type="number"
              min={1}
              max={65535}
              defaultValue={defaults.port}
              required
            />
          </label>
          <label className="field field-span-2">
            <span>{t("主机", "Host")}</span>
            <input name="host" defaultValue={defaults.host} required />
          </label>
          <label className="field field-span-2">
            <span>{t("Gremlin 路径", "Gremlin path")}</span>
            <input name="path" defaultValue={defaults.path} required />
          </label>
          <label className="field">
            <span>{t("用户名", "Username")}</span>
            <input name="username" defaultValue={defaults.username} autoComplete="username" />
          </label>
          <label className="field">
            <span>{t("密码", "Password")}</span>
            <div className="password-field">
              <input
                name="password"
                type={showPassword ? "text" : "password"}
                placeholder={
                  editing?.hasPassword
                    ? t(
                        "留空以保留已保存密码；迁移失败时请重新输入",
                        "Leave blank to keep it; re-enter after a credential migration error",
                      )
                    : t("可选", "Optional")
                }
                autoComplete="current-password"
              />
              <IconButton
                label={
                  showPassword
                    ? t("隐藏密码", "Hide password")
                    : t("显示密码", "Show password")
                }
                onClick={() => setShowPassword((current) => !current)}
              >
                {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
              </IconButton>
            </div>
          </label>
          <label className="field">
            <span>{t("客户端模式", "Client mode")}</span>
            <SelectControl
              name="clientMode"
              ariaLabel={t("客户端模式", "Client mode")}
              defaultValue={defaults.clientMode}
              options={[
                {
                  value: "sessionless",
                  label: t("非 Sessioned", "Sessionless"),
                  description: t(
                    "默认；每次查询独立，适合大多数场景",
                    "Default; isolated requests for most workloads",
                  ),
                },
                {
                  value: "sessioned",
                  label: "Sessioned",
                  description: t(
                    "跨查询保留变量和事务，仅支持 WS/WSS",
                    "Keeps variables and transactions across WS/WSS queries",
                  ),
                },
              ]}
            />
          </label>
          <label className="field">
            <span>Traversal Source</span>
            <input name="traversalSource" defaultValue={defaults.traversalSource} required />
            <small>
              {t(
                "编辑器中的 g 会映射到此服务器 Traversal Source。",
                "The editor alias g maps to this server Traversal Source.",
              )}
            </small>
          </label>
          <label className="field">
            <span>Graph Binding</span>
            <input name="graphBinding" defaultValue={defaults.graphBinding} required />
            <small>
              {t(
                "仅用于 Management API，例如 graph1；通常与 *_traversal 前缀一致。",
                "Used by Management API, for example graph1; usually matches the *_traversal prefix.",
              )}
            </small>
          </label>
          <label className="field">
            <span>{t("连接超时（ms）", "Connection timeout (ms)")}</span>
            <input
              name="connectTimeoutMs"
              type="number"
              min={500}
              max={120000}
              defaultValue={defaults.connectTimeoutMs}
              required
            />
          </label>
          <label className="field">
            <span>{t("查询超时（ms）", "Query timeout (ms)")}</span>
            <input
              name="queryTimeoutMs"
              type="number"
              min={500}
              max={3600000}
              defaultValue={defaults.queryTimeoutMs}
              required
            />
          </label>
          <details className="connection-advanced field-span-2">
            <summary>
              <SlidersHorizontal size={17} />
              <span>
                <strong>{t("高级网络设置", "Advanced network settings")}</strong>
                <small>{t("TLS 验证、WebSocket 压缩与自定义请求头", "TLS validation, WebSocket compression and custom headers")}</small>
              </span>
              <ChevronDown size={17} />
            </summary>
            <div>
              <label className="check-field">
                <input type="checkbox" name="tlsRejectUnauthorized" defaultChecked={defaults.tlsRejectUnauthorized} />
                <span>
                  <strong>{t("验证 TLS 证书", "Verify TLS certificates")}</strong>
                  <small>{t("WSS/HTTPS 默认开启；仅在受控测试环境中关闭", "Enabled for WSS/HTTPS; disable only in controlled test environments")}</small>
                </span>
              </label>
              <label className="check-field">
                <input type="checkbox" name="enableCompression" defaultChecked={defaults.enableCompression} />
                <span>
                  <strong>{t("WebSocket 压缩", "WebSocket compression")}</strong>
                  <small>{t("启用 per-message deflate，适合大型响应", "Enable per-message deflate for larger responses")}</small>
                </span>
              </label>
              <label className="field field-span-2">
                <span>{t("自定义请求头（JSON）", "Custom headers (JSON)")}</span>
                <textarea
                  name="customHeaders"
                  defaultValue={defaults.customHeaders}
                  spellCheck={false}
                  placeholder={'{\n  "X-Tenant": "graph-team"\n}'}
                />
                <small>{t("请求头以明文保存在本机数据库中，请勿在此填写密码或 Token。", "Headers are stored locally in plain text. Do not place passwords or tokens here.")}</small>
              </label>
            </div>
          </details>
        </div>
        {message && (
          <div className={`inline-message ${message.tone}`} role="status">
            {message.tone === "success" ? (
              <CheckCircle2 size={17} />
            ) : (
              <AlertTriangle size={17} />
            )}
            <span>{message.text}</span>
          </div>
        )}
        <footer className="modal-actions">
          <button type="button" className="button secondary" onClick={onClose}>
            {t("取消", "Cancel")}
          </button>
          <button
            type="button"
            className="button secondary"
            onClick={test}
            disabled={busy !== null}
          >
            {busy === "test" ? (
              <LoaderCircle className="spin" size={17} />
            ) : (
              <Activity size={17} />
            )}
            {t("测试连接", "Test Connection")}
          </button>
          <button type="submit" className="button primary" disabled={busy !== null}>
            {busy === "save" ? (
              <LoaderCircle className="spin" size={17} />
            ) : (
              <Save size={17} />
            )}
            {t("保存连接", "Save Connection")}
          </button>
        </footer>
      </form>
    </Modal>
  );
}

type QuerySuggestion = {
  value: string;
  mode: "append" | "replace";
  source: "history" | "grammar";
  detail: string;
};

type HistorySuggestionModel = {
  recent: string[];
  nextByPrefix: Map<string, Array<{ value: string; count: number }>>;
};

function appendQuerySuggestion(query: string, suggestion: string): string {
  const base = query.trimEnd();
  const normalizedSuggestion =
    base.endsWith(".") && suggestion.startsWith(".")
      ? suggestion.slice(1)
      : suggestion;
  return `${base}${normalizedSuggestion}`;
}

function buildHistorySuggestionModel(
  history: QueryHistoryEntry[],
): HistorySuggestionModel {
  const recent: string[] = [];
  const seen = new Set<string>();
  const counts = new Map<string, Map<string, number>>();
  for (const entry of history) {
    if (entry.status !== "success") continue;
    const candidate = entry.query.trim();
    if (!candidate) continue;
    if (!seen.has(candidate) && recent.length < 8) {
      seen.add(candidate);
      recent.push(candidate);
    }
    const steps = [...candidate.matchAll(/\.[A-Za-z_][A-Za-z0-9_]*\([^)]*\)/g)];
    for (let index = 0; index < steps.length - 1; index += 1) {
      const current = steps[index]!;
      const next = steps[index + 1]!;
      if (current.index === undefined || next.index === undefined) continue;
      const prefix = candidate
        .slice(0, current.index + current[0].length)
        .trim();
      const nextStep = next[0];
      const frequency = counts.get(prefix) ?? new Map<string, number>();
      frequency.set(nextStep, (frequency.get(nextStep) ?? 0) + 1);
      counts.set(prefix, frequency);
    }
  }
  return {
    recent,
    nextByPrefix: new Map(
      [...counts.entries()].map(([prefix, frequency]) => [
        prefix,
        [...frequency.entries()]
          .sort((left, right) => right[1] - left[1])
          .slice(0, 5)
          .map(([value, count]) => ({ value, count })),
      ]),
    ),
  };
}

function QueryHints({
  query,
  history,
  visible,
  onApply,
  onClose,
}: {
  query: string;
  history: QueryHistoryEntry[];
  visible: boolean;
  onApply: (suggestion: QuerySuggestion) => void;
  onClose: () => void;
}) {
  const t = useTranslate();
  const historyModel = useMemo(
    () => buildHistorySuggestionModel(history),
    [history],
  );
  const hints = useMemo(() => {
    const trimmed = query.trim();
    const fromHistory: QuerySuggestion[] = (historyModel.nextByPrefix.get(trimmed) ?? [])
      .slice(0, 3)
      .map(({ value, count }) => ({
        value,
        mode: "append",
        source: "history",
        detail: t(
          `历史中使用 ${count} 次`,
          `Used ${count} time${count === 1 ? "" : "s"} in successful history`,
        ),
      }));

    let grammar: string[];
    if (!trimmed) {
      const recent = historyModel.recent
        .slice(0, 3)
        .map<QuerySuggestion>((value) => ({
          value,
          mode: "replace",
          source: "history",
          detail: t("最近成功执行", "Recently executed successfully"),
        }));
      const templates: QuerySuggestion[] = [
        "g.V().limit(50).elementMap()",
        "g.E().limit(50).elementMap()",
        "g.V().groupCount().by(label)",
      ].map((value) => ({
        value,
        mode: "replace",
        source: "grammar",
        detail: t("安全的只读模板", "Safe read-only template"),
      }));
      return [...recent, ...templates].slice(0, 5);
    }
    if (/\.V\(\)\s*$/.test(trimmed)) {
      grammar = [".limit(50).elementMap()", ".count()", ".groupCount().by(label)"];
    } else if (/\.E\(\)\s*$/.test(trimmed)) {
      grammar = [".limit(50).elementMap()", ".count()", ".hasLabel('label')"];
    } else if (/\.has(?:Label)?\([^)]*\)\s*$/.test(trimmed)) {
      grammar = [".limit(50).elementMap()", ".count()", ".out().dedup()"];
    } else if (/\.outE\([^)]*\)\s*$|\.inE\([^)]*\)\s*$|\.bothE\([^)]*\)\s*$/.test(trimmed)) {
      grammar = [".limit(50).elementMap()", ".otherV()", ".count()"];
    } else if (/\.out\([^)]*\)\s*$|\.in\([^)]*\)\s*$|\.both\([^)]*\)\s*$/.test(trimmed)) {
      grammar = [".dedup().limit(50).elementMap()", ".path().by(elementMap())", ".count()"];
    } else if (/\.groupCount\(\)\s*$/.test(trimmed)) {
      grammar = [".by(label)", ".by(values('name'))"];
    } else if (/\.path\(\)\s*$/.test(trimmed)) {
      grammar = [".by(elementMap())", ".limit(50)"];
    } else if (/\.limit\([^)]*\)\s*$/.test(trimmed)) {
      grammar = [".elementMap()", ".path().by(elementMap())", ".count()"];
    } else if (
      /\.elementMap\(\)\s*$|\.valueMap\([^)]*\)\s*$|\.count\(\)\s*$|\.next\(\)\s*$|\.toList\(\)\s*$|\.iterate\(\)\s*$/.test(
        trimmed,
      )
    ) {
      grammar = [];
    } else if (
      !trimmed.startsWith("g.") ||
      /[;\n={}]/.test(trimmed)
    ) {
      grammar = [];
    } else {
      grammar = [".limit(50)", ".elementMap()", ".count()"];
    }
    const grammarHints: QuerySuggestion[] = grammar.map((value) => ({
      value,
      mode: "append",
      source: "grammar",
      detail: t("与当前返回类型兼容", "Compatible with the current traversal shape"),
    }));
    return [...fromHistory, ...grammarHints]
      .filter(
        (suggestion, index, values) =>
          values.findIndex((candidate) => candidate.value === suggestion.value) === index,
      )
      .slice(0, 5);
  }, [historyModel, query, t]);

  if (!visible || hints.length === 0) return null;
  return (
    <div className="query-suggestion-popover" role="listbox" aria-label={t("下一步")}>
      <header>
        <span>
          <Zap size={15} />
          {t("下一步建议", "Next-step suggestions")}
        </span>
        <div className="query-suggestion-header-actions">
          <small>{t("基于成功历史与 Gremlin Step 兼容性", "Successful history + Gremlin step compatibility")}</small>
          <button
            type="button"
            className="query-suggestion-close"
            aria-label={t("关闭建议", "Close suggestions")}
            title={t("关闭建议", "Close suggestions")}
            onPointerDown={(event) => event.preventDefault()}
            onClick={onClose}
          >
            <X size={16} />
          </button>
        </div>
      </header>
      <div className="query-suggestion-list">
        {hints.map((hint) => (
          <button
            type="button"
            role="option"
            key={`${hint.mode}:${hint.value}`}
            onPointerDown={(event) => event.preventDefault()}
            onClick={() => onApply(hint)}
          >
            <code>{hint.value}</code>
            <span>
              {hint.source === "history"
                ? t("历史", "History")
                : t("语法", "Grammar")}
            </span>
            <small>{hint.detail}</small>
          </button>
        ))}
      </div>
    </div>
  );
}

function GraphCanvas({
  model,
  selection,
  onSelect,
}: {
  model: GraphModel;
  selection: Selection;
  onSelect: (selection: Selection) => void;
}) {
  const visibleNodes = model.nodes.slice(0, 80);
  const visibleNodeIds = new Set(visibleNodes.map((node) => node.id));
  const visibleEdges = model.edges
    .filter((edge) => visibleNodeIds.has(edge.from) && visibleNodeIds.has(edge.to))
    .slice(0, 160);
  const positions = useMemo(() => {
    const width = 960;
    const height = 560;
    const centerX = width / 2;
    const centerY = height / 2;
    const count = Math.max(visibleNodes.length, 1);
    const radiusX = Math.min(360, 100 + count * 18);
    const radiusY = Math.min(210, 70 + count * 12);
    return Object.fromEntries(
      visibleNodes.map((node, index) => {
        if (count === 1) return [node.id, { x: centerX, y: centerY }];
        const angle = (index / count) * Math.PI * 2 - Math.PI / 2;
        const ring = index % 3 === 0 ? 0.78 : 1;
        return [
          node.id,
          {
            x: centerX + Math.cos(angle) * radiusX * ring,
            y: centerY + Math.sin(angle) * radiusY * ring,
          },
        ];
      }),
    ) as Record<string, { x: number; y: number }>;
  }, [visibleNodes]);

  if (visibleNodes.length === 0) {
    return (
      <EmptyState
        icon={<Network size={30} />}
        title="当前结果不能转换为拓扑"
        description="拓扑视图会识别 Vertex、Edge、Path 或包含 id、label、outV、inV 的对象。请切换到表格或 JSON 查看原始结果。"
      />
    );
  }

  return (
    <div className="graph-stage">
      <svg viewBox="0 0 960 560" role="img" aria-label="查询结果拓扑图">
        <defs>
          <marker
            id="graph-arrow"
            viewBox="0 0 12 12"
            refX="11"
            refY="6"
            markerWidth="22"
            markerHeight="22"
            markerUnits="userSpaceOnUse"
            orient="auto"
          >
            <path d="M 1.5 1.5 L 11 6 L 1.5 10.5 L 3.6 6 Z" />
          </marker>
        </defs>
        <g className="edge-layer">
          {visibleEdges.map((edge) => {
            const from = positions[edge.from];
            const to = positions[edge.to];
            if (!from || !to) return null;
            const selected = selection?.kind === "edge" && selection.value.id === edge.id;
            return (
              <g
                key={edge.id}
                className={selected ? "graph-edge is-selected" : "graph-edge"}
                role="button"
                tabIndex={0}
                onClick={() => onSelect({ kind: "edge", value: edge })}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    onSelect({ kind: "edge", value: edge });
                  }
                }}
              >
                <line className="edge-hit" x1={from.x} y1={from.y} x2={to.x} y2={to.y} />
                <line
                  className="edge-line"
                  x1={from.x}
                  y1={from.y}
                  x2={to.x}
                  y2={to.y}
                  markerEnd="url(#graph-arrow)"
                />
                <text x={(from.x + to.x) / 2} y={(from.y + to.y) / 2 - 8}>
                  {edge.label}
                </text>
              </g>
            );
          })}
        </g>
        <g className="node-layer">
          {visibleNodes.map((node) => {
            const position = positions[node.id];
            if (!position) return null;
            const selected = selection?.kind === "node" && selection.value.id === node.id;
            return (
              <g
                key={node.id}
                className={selected ? "graph-node is-selected" : "graph-node"}
                transform={`translate(${position.x} ${position.y})`}
                role="button"
                tabIndex={0}
                onClick={() => onSelect({ kind: "node", value: node })}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    onSelect({ kind: "node", value: node });
                  }
                }}
              >
                <circle r="29" />
                <CircleDot x={-10} y={-10} width={20} height={20} />
                <text className="node-label" y="47">
                  {node.label}
                </text>
                <text className="node-id" y="64">
                  {node.id}
                </text>
              </g>
            );
          })}
        </g>
      </svg>
      {(model.nodes.length > 80 || model.edges.length > 160) && (
        <div className="graph-limit">
          为保证交互性能，仅渲染前 80 个顶点和 160 条边
        </div>
      )}
    </div>
  );
}

function ElementInspector({
  selection,
  onClose,
  detailState,
}: {
  selection: Selection;
  onClose: () => void;
  detailState: SelectionDetailState;
}) {
  const t = useTranslate();
  if (!selection) return null;
  const { value } = selection;
  const identity =
    selection.kind === "node"
      ? { ID: value.id, LABEL: value.label }
      : {
          ID: selection.value.id,
          LABEL: selection.value.label,
          FROM: selection.value.from,
          TO: selection.value.to,
        };
  return (
    <aside className="element-inspector" aria-label={t("图元素详情", "Graph element details")}>
      <header>
        <div>
          <span className="eyebrow">
            {selection.kind === "node" ? "VERTEX DETAIL" : "EDGE DETAIL"}
          </span>
          <h3>{value.label}</h3>
        </div>
        <IconButton label={t("关闭详情")} onClick={onClose}>
          <X size={18} />
        </IconButton>
      </header>
      {detailState.status === "loading" && (
        <div className="inspector-status is-loading" role="status">
          <LoaderCircle className="spin" size={17} />
          <span>
            {t(
              "正在读取 JanusGraph 中的完整属性…",
              "Loading complete properties from JanusGraph…",
            )}
          </span>
        </div>
      )}
      {detailState.status === "error" && (
        <div className="inspector-status is-error" role="alert">
          <AlertTriangle size={17} />
          <span>{detailState.message}</span>
        </div>
      )}
      <dl className="property-list">
        {orderedInspectorEntries({ ...identity, ...value.properties }).map(([key, entry]) => (
          <div key={key}>
            <dt>{key}</dt>
            <dd>{printableValue(entry)}</dd>
          </div>
        ))}
      </dl>
    </aside>
  );
}

function TableResult({ rows, rawItems }: { rows: ResultRow[]; rawItems: unknown[] }) {
  const t = useTranslate();
  if (rows.length === 0) {
    return (
      <EmptyState
        icon={<Table2 size={30} />}
        title={t("查询成功，结果为空")}
        description={t("服务器返回了零条记录。")}
      />
    );
  }
  return <DataGrid rows={rows} rawItems={rawItems} />;
}

function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow: string;
  title: string;
  description: string;
  actions?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </header>
  );
}

function QueryPage({
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
  query,
  setQuery,
  bindingsText,
  setBindingsText,
  bindingsEnabled,
  setBindingsEnabled,
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
  query: string;
  setQuery: (query: string) => void;
  bindingsText: string;
  setBindingsText: (value: string) => void;
  bindingsEnabled: boolean;
  setBindingsEnabled: (value: boolean) => void;
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
  notify: (toast: ToastState) => void;
}) {
  const t = useTranslate();
  const schemaCatalog = useMemo<GremlinSchemaCatalog>(() => {
    if (!activeConnection) return EMPTY_SCHEMA_CATALOG;
    try {
      const stored = JSON.parse(
        localStorage.getItem(`janusgraph.schemaCatalog.v1.${activeConnection.id}`) ?? "null",
      ) as GremlinSchemaCatalog | null;
      return stored && Array.isArray(stored.vertexLabels) && Array.isArray(stored.edgeLabels) && Array.isArray(stored.propertyKeys)
        ? stored
        : EMPTY_SCHEMA_CATALOG;
    } catch {
      return EMPTY_SCHEMA_CATALOG;
    }
  }, [activeConnection?.id]);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [monacoSuggestionsOpen, setMonacoSuggestionsOpen] = useState(false);
  const [parametersOpen, setParametersOpen] = useState(false);
  const [bindingsError, setBindingsError] = useState("");
  const [favoritesOpen, setFavoritesOpen] = useState(false);
  const [transactionPanelOpen, setTransactionPanelOpen] = useState(false);
  const [tabMenu, setTabMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [renamingTabId, setRenamingTabId] = useState<string | null>(null);
  const [renamingTabTitle, setRenamingTabTitle] = useState("");
  const [savedQueries, setSavedQueries] = useState<SavedQuery[]>(loadSavedQueries);
  const [savedQueryName, setSavedQueryName] = useState("");
  const [renamingSavedQueryId, setRenamingSavedQueryId] = useState<string | null>(null);
  const [renamingSavedQueryName, setRenamingSavedQueryName] = useState("");
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
  const tableRows = useMemo(
    () => (result ? buildTableRows(result.items) : []),
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
  }, [activeConnection?.clientMode, bindingsEnabled, bindingsText, notify, query, runQuery, selectedQuery]);

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

  const addSavedQuery = () => {
    if (!query.trim()) {
      notify({ tone: "info", message: t("当前查询为空", "The current query is empty") });
      return;
    }
    const compact = query.replace(/\s+/g, " ").trim();
    const tabTitle = tabs.find((tab) => tab.id === activeTabId)?.title;
    const next: SavedQuery = {
      id: crypto.randomUUID(),
      name: savedQueryName.trim() || tabTitle || compact.slice(0, 56),
      query,
      bindingsText,
      createdAt: new Date().toISOString(),
    };
    setSavedQueries((current) => {
      const entries = [next, ...current.filter((entry) => entry.query !== query)];
      saveSavedQueries(entries);
      return entries;
    });
    setSavedQueryName("");
    notify({ tone: "success", message: t("查询已加入收藏", "Query added to favorites") });
  };

  const commitSavedQueryRename = (id: string) => {
    const name = renamingSavedQueryName.trim();
    if (name) {
      setSavedQueries((current) => {
        const entries = current.map((entry) => entry.id === id ? { ...entry, name } : entry);
        saveSavedQueries(entries);
        return entries;
      });
    }
    setRenamingSavedQueryId(null);
    setRenamingSavedQueryName("");
  };

  const removeSavedQuery = (id: string) => {
    setSavedQueries((current) => {
      const entries = current.filter((entry) => entry.id !== id);
      saveSavedQueries(entries);
      return entries;
    });
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
          <div>
            <span className="eyebrow">GREMLIN EDITOR</span>
            <div className="editor-connection-line">
              <strong>{activeConnection?.name ?? t("未选择连接")}</strong>
              {activeConnection && (
                <small className="editor-connection-context">
                  {activeConnection.protocol.toUpperCase()} · {activeConnection.clientMode === "sessioned"
                    ? t("此标签页独立会话", "Private tab session")
                    : t("独立请求", "Isolated requests")}
                </small>
              )}
              <small className={`editor-save-status ${query !== savedContent ? "is-dirty" : "is-saved"}`}>
                {query !== savedContent
                  ? t("未保存更改", "Unsaved changes")
                  : scriptName
                    ? t("已保存", "Saved")
                    : t("空白标签页", "Blank tab")}
              </small>
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
                className={`${bindingsEnabled ? "is-active" : ""} ${parametersOpen ? "is-open" : ""}`.trim()}
                onClick={() => { setParametersOpen((value) => !value); setFavoritesOpen(false); setSuggestionsOpen(false); }}
                title={bindingsEnabled
                  ? t("参数绑定已启用，点击打开配置", "Bindings enabled; open configuration")
                  : t("参数绑定未启用，点击打开配置", "Bindings disabled; open configuration")}
              >
                <SlidersHorizontal size={16} />
                <span>{t("参数", "Parameters")}</span>
                {bindingsEnabled && <i className="parameters-live-dot" aria-hidden="true" />}
              </button>
              <button
                type="button"
                className={favoritesOpen ? "is-active" : ""}
                onClick={() => { setFavoritesOpen((value) => !value); setParametersOpen(false); setSuggestionsOpen(false); }}
                title={t("收藏查询", "Saved queries")}
              >
                <Star size={16} />
                <span>{t("收藏", "Favorites")}</span>
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
                disabled={!query.trim() || queryState.status === "loading"}
                onClick={() => runEditorQuery(withTraversalAnalysis(selectedQuery.trim() || query, "explain"))}
                title={t("Explain：查看遍历策略优化计划", "Explain traversal strategy optimization")}
              >
                <GitBranch size={16} />
                <span>Explain</span>
              </button>
              <button
                type="button"
                disabled={!query.trim() || queryState.status === "loading"}
                onClick={() => runEditorQuery(withTraversalAnalysis(selectedQuery.trim() || query, "profile"))}
                title={t("Profile：执行并分析每个 Step 的耗时", "Profile step execution time")}
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
                <span className="eyebrow">QUERY BINDINGS</span>
                <strong>{t("参数绑定", "Parameter bindings")}</strong>
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
                <span className="eyebrow">SAVED QUERIES</span>
                <strong>{t("收藏查询", "Saved queries")}</strong>
              </div>
              <button type="button" onClick={() => setFavoritesOpen(false)} aria-label={t("关闭收藏", "Close favorites")}><X size={16} /></button>
            </header>
            <form className="saved-query-create" onSubmit={(event) => { event.preventDefault(); addSavedQuery(); }}>
              <label>
                <span>{t("收藏名称", "Favorite name")}</span>
                <input
                  value={savedQueryName}
                  onChange={(event) => setSavedQueryName(event.target.value)}
                  maxLength={80}
                  placeholder={tabs.find((tab) => tab.id === activeTabId)?.title || t("为查询命名", "Name this query")}
                  aria-label={t("收藏查询名称", "Favorite query name")}
                />
              </label>
              <button type="submit" className="save-current-query" disabled={!query.trim()}>
                <Plus size={16} />
                {t("加入收藏", "Add favorite")}
              </button>
            </form>
            <div className="saved-query-list">
              {savedQueries.length === 0 ? (
                <p>{t("尚无收藏查询", "No saved queries yet")}</p>
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
                      aria-label={t("重命名收藏", "Rename favorite")}
                    />
                  ) : (
                    <button type="button" onClick={() => {
                      setQuery(entry.query);
                      setBindingsText(entry.bindingsText);
                      try {
                        setBindingsEnabled(Object.keys(parseBindings(entry.bindingsText)).length > 0);
                      } catch {
                        setBindingsEnabled(false);
                      }
                      setFavoritesOpen(false);
                    }}>
                      <strong>{entry.name}</strong>
                      <code>{entry.query}</code>
                    </button>
                  )}
                  <button type="button" onClick={() => {
                    setRenamingSavedQueryId(entry.id);
                    setRenamingSavedQueryName(entry.name);
                  }} aria-label={t(`重命名 ${entry.name}`, `Rename ${entry.name}`)}><Edit3 size={15} /></button>
                  <button type="button" onClick={() => removeSavedQuery(entry.id)} aria-label={t(`删除 ${entry.name}`, `Delete ${entry.name}`)}><Trash2 size={15} /></button>
                </div>
              ))}
            </div>
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
              g <span>→</span> {activeConnection.traversalSource}
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
                {result.totalCount.toLocaleString()} 条 · {result.durationMs} ms
                {result.truncated ? ` · ${result.items.length.toLocaleString()} 条已载入` : ""}
              </strong>
            ) : (
              <strong>{t("等待执行")}</strong>
            )}
          </div>
          <div className="result-toolbar-actions">
            <div className="result-modes" aria-label={t("结果显示方式")}>
              <button
              type="button"
              className={mode === "graph" ? "is-active" : ""}
              onClick={() => setMode("graph")}
            >
              <Waypoints size={17} />
              {t("拓扑")}
              </button>
              <button
              type="button"
              className={mode === "table" ? "is-active" : ""}
              onClick={() => setMode("table")}
            >
              <Table2 size={17} />
              {t("表格")}
              </button>
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
                className={mode === "raw" ? "is-active" : ""}
                onClick={() => setMode("raw")}
                title={t("以 Gremlin Console 行格式查看结果", "Inspect results in Gremlin Console line format")}
              >
                <Code2 size={17} />
                {t("控制台", "Console")}
              </button>
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
          {result && mode === "table" && <TableResult rows={tableRows} rawItems={result.items} />}
          {result && mode === "json" && (
            <pre className="json-result">
              {JSON.stringify(structuredItems, null, 2)}
            </pre>
          )}
          {result && mode === "raw" && (
            <div className="raw-result">
              <header>
                <div>
                  <span className="eyebrow">GREMLIN CONSOLE</span>
                  <strong>{t("控制台原始结果", "Console result")}</strong>
                </div>
                <small>{t("每条结果使用 ==> 前缀，Map 以 key=value 形式展示。", "Each result uses the ==> prefix and maps are rendered as key=value pairs.")}</small>
                <button type="button" onClick={() => {
                  void navigator.clipboard.writeText(gremlinConsoleOutput(result.items)).then(() => {
                    notify({ tone: "success", message: t("控制台输出已复制", "Console output copied") });
                  }).catch((error) => {
                    notify({ tone: "error", message: errorMessage(error) });
                  });
                }}>
                  <Copy size={15} />
                  {t("复制控制台输出", "Copy console output")}
                </button>
              </header>
              <pre>{gremlinConsoleOutput(result.items)}</pre>
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

function ConnectionsPage({
  connections,
  activeConnectionId,
  onActivate,
  onAdd,
  onEdit,
  onDelete,
  onTest,
}: {
  connections: ConnectionSummary[];
  activeConnectionId: string;
  onActivate: (id: string) => void;
  onAdd: () => void;
  onEdit: (connection: ConnectionSummary) => void;
  onDelete: (connection: ConnectionSummary) => void;
  onTest: (connection: ConnectionSummary) => Promise<void>;
}) {
  const t = useTranslate();
  const [testingId, setTestingId] = useState("");
  return (
    <div className="page-scroll">
      <PageHeader
        eyebrow="CONNECTIONS"
        title={t("连接管理")}
        description={t(
          "管理多个 JanusGraph Server 账号、协议、认证信息和超时设置。密码优先使用系统密钥设施，不可用时自动切换本地加密。",
          "Manage JanusGraph profiles, protocols, credentials and timeouts. Credentials use OS secure storage with an encrypted local fallback.",
        )}
        actions={
          <button type="button" className="button primary" onClick={onAdd}>
            <Plus size={17} />
            {t("添加连接", "Add Connection")}
          </button>
        }
      />
      {connections.length === 0 ? (
        <EmptyState
          icon={<Database size={32} />}
          title={t("还没有连接配置", "No connection profiles yet")}
          description={t(
            "添加 WS、WSS、HTTP 或 HTTPS 连接后即可执行真实查询。",
            "Add a WS, WSS, HTTP or HTTPS profile to run live queries.",
          )}
          action={
            <button type="button" className="button primary" onClick={onAdd}>
              <Plus size={17} />
              {t("添加第一个连接", "Add First Connection")}
            </button>
          }
        />
      ) : (
        <div className="connection-grid">
          {connections.map((connection) => {
            const active = connection.id === activeConnectionId;
            return (
              <article
                className={`connection-profile ${active ? "is-active" : ""}`}
                key={connection.id}
              >
                <header>
                  <div className="connection-symbol">
                    <Server size={21} />
                  </div>
                  <div>
                    <div className="connection-title-line">
                      <h2>{connection.name}</h2>
                      {active && (
                        <span className="badge success">{t("当前连接")}</span>
                      )}
                    </div>
                    <code>{connectionEndpoint(connection)}</code>
                  </div>
                </header>
                <dl className="connection-meta">
                  <div>
                    <dt>{t("协议", "Protocol")}</dt>
                    <dd>{connection.protocol.toUpperCase()}</dd>
                  </div>
                  <div>
                    <dt>Client</dt>
                    <dd>
                      {connection.clientMode === "sessioned"
                        ? "SESSIONED"
                        : "SESSIONLESS"}
                    </dd>
                  </div>
                  <div>
                    <dt>g Alias</dt>
                    <dd>{connection.traversalSource}</dd>
                  </div>
                  <div>
                    <dt>Management</dt>
                    <dd>{connection.graphBinding}</dd>
                  </div>
                  <div>
                    <dt>{t("账号", "Account")}</dt>
                    <dd>{connection.username || t("匿名", "Anonymous")}</dd>
                  </div>
                  <div>
                    <dt>{t("凭据", "Credential")}</dt>
                    <dd>
                      {connection.hasPassword
                        ? t("已加密保存", "Encrypted")
                        : t("未保存", "Not saved")}
                    </dd>
                  </div>
                </dl>
                <footer>
                  <button
                    type="button"
                    className="button secondary"
                    disabled={testingId === connection.id}
                    onClick={async () => {
                      setTestingId(connection.id);
                      await onTest(connection);
                      setTestingId("");
                    }}
                  >
                    {testingId === connection.id ? (
                      <LoaderCircle className="spin" size={16} />
                    ) : (
                      <Activity size={16} />
                    )}
                    {t("测试", "Test")}
                  </button>
                  {!active && (
                    <button
                      type="button"
                      className="button secondary"
                      onClick={() => onActivate(connection.id)}
                    >
                      <Check size={16} />
                      {t("设为当前", "Set Active")}
                    </button>
                  )}
                  <IconButton
                    label={`${t("编辑", "Edit")} ${connection.name}`}
                    onClick={() => onEdit(connection)}
                  >
                    <Edit3 size={17} />
                  </IconButton>
                  <IconButton
                    label={`${t("删除")} ${connection.name}`}
                    tone="danger"
                    onClick={() => onDelete(connection)}
                  >
                    <Trash2 size={17} />
                  </IconButton>
                </footer>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}

function HistoryPage({
  history,
  onUse,
  onRemove,
  onClear,
}: {
  history: QueryHistoryEntry[];
  onUse: (entry: QueryHistoryEntry) => void;
  onRemove: (entry: QueryHistoryEntry) => void;
  onClear: () => void;
}) {
  const t = useTranslate();
  const locale = useLocale();
  const [search, setSearch] = useState("");
  const filtered = history.filter(
    (entry) =>
      entry.query.toLowerCase().includes(search.toLowerCase()) ||
      entry.connectionName.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <div className="page-scroll">
      <PageHeader
        eyebrow="LOCAL HISTORY"
        title={t("执行历史")}
        description={t(
          "查询成功和失败记录均保存在本机 SQLite 数据库中，不会上传到外部服务。",
          "Successful and failed queries are stored in local SQLite and never uploaded.",
        )}
        actions={
          history.length > 0 ? (
            <button type="button" className="button danger ghost" onClick={onClear}>
              <Trash2 size={17} />
              {t("清空历史")}
            </button>
          ) : undefined
        }
      />
      <div className="history-tools">
        <Search size={18} />
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={t("搜索语句或连接名称", "Search query or connection")}
          aria-label={t("搜索执行历史", "Search execution history")}
        />
        <span>{filtered.length} 条</span>
      </div>
      {filtered.length === 0 ? (
        <EmptyState
          icon={<Clock3 size={31} />}
          title={
            history.length
              ? t("没有匹配的历史", "No matching history")
              : t("还没有执行记录", "No execution records yet")
          }
          description={
            history.length
              ? t("尝试修改搜索关键词。", "Try a different search term.")
              : t(
                  "成功或失败的查询执行后会自动出现在这里。",
                  "Queries appear here automatically after execution.",
                )
          }
        />
      ) : (
        <div className="history-table-wrap">
          <table className="history-table">
            <thead>
              <tr>
                <th>{t("状态", "Status")}</th>
                <th>{t("查询语句", "Query")}</th>
                <th>{t("连接", "Connection")}</th>
                <th>{t("结果", "Results")}</th>
                <th>{t("耗时", "Duration")}</th>
                <th>{t("时间", "Time")}</th>
                <th>{t("操作", "Actions")}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((entry) => (
                <tr key={entry.id}>
                  <td>
                    <span className={`badge ${entry.status}`}>
                      {entry.status === "success" ? t("成功") : t("失败")}
                    </span>
                  </td>
                  <td>
                    <code title={entry.query}>{entry.query}</code>
                    {entry.errorMessage && <small>{entry.errorMessage}</small>}
                  </td>
                  <td>{entry.connectionName}</td>
                  <td>{entry.resultCount}</td>
                  <td>{entry.durationMs} ms</td>
                  <td>{formatDate(entry.createdAt, locale)}</td>
                  <td>
                    <div className="row-actions">
                      <button
                        type="button"
                        className="button text"
                        onClick={() => onUse(entry)}
                      >
                        <Code2 size={16} />
                        {t("载入")}
                      </button>
                      <IconButton
                        label={t("删除此记录", "Delete this record")}
                        tone="danger"
                        onClick={() => onRemove(entry)}
                      >
                        <Trash2 size={16} />
                      </IconButton>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function schemaOverviewScripts(connection: ConnectionSummary): Array<{
  label: string;
  query: string;
}> {
  const graphBinding = stringLiteral(safeIdentifier(connection.graphBinding));
  const traversalBinding = stringLiteral(safeIdentifier(connection.traversalSource));
  const openManagement = `def __binding = this.getBinding()
def __graph = __binding.hasVariable(${graphBinding}) ? __binding.getVariable(${graphBinding}) : null
def __source = __binding.hasVariable(${traversalBinding}) ? __binding.getVariable(${traversalBinding}) : (__binding.hasVariable("g") ? __binding.getVariable("g") : null)
if (__graph == null && __source != null) {
  def __optionalGraph = __source.getGraph()
  __graph = __optionalGraph.isPresent() ? __optionalGraph.get() : null
}
if (__graph == null) { throw new IllegalStateException("Active JanusGraph graph binding is unavailable") }
def mgmt = __graph.openManagement()
def rows = []`;
  const wrap = (body: string) => `${openManagement}
try {
${body}
  return rows
} finally {
  if (mgmt != null && mgmt.isOpen()) { mgmt.rollback() }
}`;
  const indexBody = (element: "Vertex" | "Edge") => `  mgmt.getGraphIndexes(org.apache.tinkerpop.gremlin.structure.${element}.class).each { index ->
    def fields = index.getFieldKeys()
    def statuses = fields.collectEntries { key -> [(key.name()): index.getIndexStatus(key).name()] }
    rows << [group: "graphIndexes", name: index.name(), element: "${element}", type: index.isMixedIndex() ? "MIXED" : "COMPOSITE", unique: index.isUnique(), backingIndex: index.getBackingIndex(), fields: fields.collect { key -> key.name() }, fieldStatus: statuses, status: statuses.values().toSet().join(", ") ?: "UNKNOWN"]
  }`;
  return [
    {
      label: "Vertex Label",
      query: wrap(`  mgmt.getVertexLabels().each { label ->
    rows << [group: "vertexLabels", name: label.name(), partitioned: label.isPartitioned(), static: label.isStatic()]
  }`),
    },
    {
      label: "Edge Label",
      query: wrap(`  mgmt.getRelationTypes(org.janusgraph.core.EdgeLabel.class).each { label ->
    rows << [group: "edgeLabels", name: label.name(), multiplicity: label.multiplicity().name()]
  }`),
    },
    {
      label: "Property Key",
      query: wrap(`  mgmt.getRelationTypes(org.janusgraph.core.PropertyKey.class).each { key ->
    rows << [group: "propertyKeys", name: key.name(), dataType: key.dataType().simpleName, cardinality: key.cardinality().name()]
  }`),
    },
    { label: "Vertex Index", query: wrap(indexBody("Vertex")) },
    { label: "Edge Index", query: wrap(indexBody("Edge")) },
  ];
}

function schemaSnapshotRows(items: unknown[]) {
  return schemaRowsFromItems(items)
    .map((value) => ({ ...value }))
    .sort((left, right) => `${left.group}:${left.name}`.localeCompare(`${right.group}:${right.name}`));
}

function compareSchemaRows(previous: Record<string, unknown>[], current: Record<string, unknown>[]) {
  const keyed = (values: Record<string, unknown>[]) => new Map(values.map((value) => [`${value.group}:${value.name}`, JSON.stringify(value)]));
  const before = keyed(previous);
  const after = keyed(current);
  return {
    added: [...after.keys()].filter((key) => !before.has(key)),
    removed: [...before.keys()].filter((key) => !after.has(key)),
    changed: [...after.keys()].filter((key) => before.has(key) && before.get(key) !== after.get(key)),
  };
}

function SchemaOverview({
  items,
  onIndexAction,
  indexBusy,
}: {
  items: unknown[];
  onIndexAction: (name: string, action: string) => void;
  indexBusy: string;
}) {
  const t = useTranslate();
  const [activeGroup, setActiveGroup] = useState<
    "vertexLabels" | "edgeLabels" | "propertyKeys" | "graphIndexes"
  >("vertexLabels");
  const [search, setSearch] = useState("");
  const [visibleCount, setVisibleCount] = useState(60);
  const rows = schemaRowsFromItems(items);
  const groups: Array<{
    key: typeof activeGroup;
    eyebrow: string;
    label: string;
    icon: ReactNode;
  }> = [
    {
      key: "vertexLabels",
      eyebrow: "VERTEX LABEL",
      label: t("顶点标签", "Vertex Labels"),
      icon: <CircleDot size={18} />,
    },
    {
      key: "edgeLabels",
      eyebrow: "EDGE LABEL",
      label: t("关系标签", "Edge Labels"),
      icon: <Waypoints size={18} />,
    },
    {
      key: "propertyKeys",
      eyebrow: "PROPERTY KEY",
      label: t("属性键", "Property Keys"),
      icon: <KeyRound size={18} />,
    },
    {
      key: "graphIndexes",
      eyebrow: "GRAPH INDEX",
      label: t("图索引", "Graph Indexes"),
      icon: <Database size={18} />,
    },
  ];
  const values = rows.filter((row) => row.group === activeGroup);
  const indexes = rows.filter((row) => row.group === "graphIndexes");
  const normalizedSearch = search.trim().toLowerCase();
  const filtered = values.filter((value) =>
    JSON.stringify(value).toLowerCase().includes(normalizedSearch),
  );

  const definition = (value: Record<string, unknown>, index: number) => {
    const name = String(value.name ?? `${activeGroup}-${index + 1}`);
    if (activeGroup === "propertyKeys") {
      const linked = indexes.filter(
        (candidate) =>
          Array.isArray(candidate.fields) &&
          candidate.fields.some((field) => String(field) === name),
      );
      return (
        <article className="schema-definition-card" key={name}>
          <div className="schema-definition-main">
            <KeyRound size={17} />
            <span>
              <strong>{name}</strong>
              <small>
                {String(value.dataType ?? "Unknown")} ·{" "}
                {String(value.cardinality ?? "SINGLE")}
              </small>
            </span>
          </div>
          <div className="schema-index-links">
            {linked.length ? (
              linked.map((item) => (
                <span
                  key={String(item.name)}
                  className={`schema-index-chip ${String(item.type).toLowerCase()}`}
                  title={`${String(item.name)} · ${String(item.status ?? "")}`}
                >
                  {String(item.type) === "MIXED" ? "M" : "C"}
                  <b>{String(item.name)}</b>
                </span>
              ))
            ) : (
              <small>{t("无关联索引", "No linked index")}</small>
            )}
          </div>
        </article>
      );
    }
    if (activeGroup === "graphIndexes") {
      const fields = Array.isArray(value.fields) ? value.fields : [];
      const status = String(value.status ?? "UNKNOWN");
      const actions = status.includes("ENABLED")
        ? ["REINDEX", "DISABLE_INDEX"]
        : status.includes("DISABLED")
          ? ["REINDEX", "REMOVE_INDEX"]
          : status.includes("REGISTERED")
            ? ["ENABLE_INDEX", "REINDEX"]
            : ["REGISTER_INDEX", "ENABLE_INDEX"];
      return (
        <article className="schema-definition-card schema-index-card" key={name}>
          <div className="schema-definition-main">
            <Database size={17} />
            <span>
              <strong>{name}</strong>
              <small>
                {String(value.element ?? "Vertex")} · {String(value.backingIndex ?? "")}
              </small>
            </span>
          </div>
          <div className="schema-index-links">
            <span
              className={`schema-index-chip ${String(value.type).toLowerCase()}`}
            >
              {String(value.type) === "MIXED" ? "M" : "C"}
              <b>{String(value.status ?? "UNKNOWN")}</b>
            </span>
            {fields.map((field) => (
              <code key={String(field)} title={String((value.fieldStatus as Record<string, unknown> | undefined)?.[String(field)] ?? status)}>{String(field)}</code>
            ))}
          </div>
          <div className="schema-index-actions">
            {actions.map((action) => (
              <button
                type="button"
                key={action}
                disabled={Boolean(indexBusy)}
                onClick={() => onIndexAction(name, action)}
              >
                {indexBusy === `${name}:${action}` && <LoaderCircle className="spin" size={13} />}
                {t(
                  action === "REINDEX" ? "重建" : action === "DISABLE_INDEX" ? "禁用" : action === "REMOVE_INDEX" ? "删除" : action === "ENABLE_INDEX" ? "启用" : "注册",
                  action.replace("_INDEX", "").toLowerCase(),
                )}
              </button>
            ))}
          </div>
        </article>
      );
    }
    const isVertex = activeGroup === "vertexLabels";
    return (
      <article className="schema-definition-card" key={name}>
        <div className="schema-definition-main">
          {isVertex ? <CircleDot size={17} /> : <Waypoints size={17} />}
          <span>
            <strong>{name}</strong>
            <small>
              {isVertex
                ? `${t("分区", "Partitioned")}: ${String(value.partitioned ?? false)} · ${t("静态", "Static")}: ${String(value.static ?? false)}`
                : `${t("多重性", "Multiplicity")}: ${String(value.multiplicity ?? "MULTI")}`}
            </small>
          </span>
        </div>
      </article>
    );
  };

  return (
    <div className="schema-browser">
      <div className="schema-group-tabs" role="tablist">
        {groups.map((group) => {
          const count = rows.filter((row) => row.group === group.key).length;
          return (
            <button
              type="button"
              role="tab"
              aria-selected={activeGroup === group.key}
              className={activeGroup === group.key ? "is-active" : ""}
              key={group.key}
              onClick={() => {
                setActiveGroup(group.key);
                setSearch("");
                setVisibleCount(60);
              }}
            >
              {group.icon}
              <span>
                <small>{group.eyebrow}</small>
                <strong>{group.label}</strong>
              </span>
              <b>{count}</b>
            </button>
          );
        })}
      </div>
      <div className="schema-search">
        <Search size={17} />
        <input
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setVisibleCount(60);
          }}
          placeholder={t("搜索名称、类型或索引", "Search name, type or index")}
          aria-label={t("搜索 Schema", "Search schema")}
        />
        <span>{filtered.length}</span>
      </div>
      <div className="schema-definition-grid">
        {filtered.slice(0, visibleCount).map(definition)}
      </div>
      {filtered.length === 0 && (
        <p className="schema-empty">
          {t("当前图没有此类定义", "No definitions in this category")}
        </p>
      )}
      {filtered.length > visibleCount && (
        <button
          type="button"
          className="button secondary schema-show-more"
          onClick={() => setVisibleCount((count) => count + 60)}
        >
          {t("显示更多", "Show more")} · {filtered.length - visibleCount}
        </button>
      )}
    </div>
  );
}

function IndexFields({
  mixed,
  t,
  includeName = false,
  nameField = "name",
}: {
  mixed: boolean;
  t: (chinese: string, english?: string) => string;
  includeName?: boolean;
  nameField?: string;
}) {
  return (
    <>
      {includeName && (
        <label className="field">
          <span>{t("索引名称", "Index name")}</span>
          <input name={nameField} required maxLength={120} />
        </label>
      )}
      <label className="field">
        <span>{t("索引元素", "Indexed element")}</span>
        <SelectControl
          name="indexElement"
          ariaLabel={t("索引元素", "Indexed element")}
          defaultValue="Vertex"
          options={[
            { value: "Vertex", label: "Vertex" },
            { value: "Edge", label: "Edge" },
          ]}
        />
      </label>
      {mixed ? (
        <label className="field field-span-2">
          <span>{t("Mixed Index 后端", "Mixed index backend")}</span>
          <input
            name="indexBackend"
            defaultValue="search"
            required
            placeholder="search"
          />
          <small>
            {t(
              "填写 JanusGraph 配置中的索引后端名称，例如 search。",
              "Use the index backend configured in JanusGraph, for example search.",
            )}
          </small>
        </label>
      ) : (
        <label className="check-field field-span-2">
          <input type="checkbox" name="unique" />
          <span>
            <strong>{t("唯一索引", "Unique index")}</strong>
            <small>
              {t(
                "仅 Composite Index 支持 unique。",
                "Only Composite indexes can be unique.",
              )}
            </small>
          </span>
        </label>
      )}
    </>
  );
}

function SchemaPage({
  activeConnection,
  execute,
}: {
  activeConnection: ConnectionSummary | undefined;
  execute: (query: string) => Promise<QueryExecutionResult>;
}) {
  const t = useTranslate();
  const [state, setState] = useState<QueryState>({ status: "idle" });
  const [kind, setKind] = useState<"property" | "vertex" | "edge" | "index">(
    "property",
  );
  const [propertyComposite, setPropertyComposite] = useState(false);
  const [propertyMixed, setPropertyMixed] = useState(false);
  const [existingIndexType, setExistingIndexType] = useState<
    "composite" | "mixed"
  >("composite");
  const [busy, setBusy] = useState(false);
  const [indexBusy, setIndexBusy] = useState("");
  const [schemaWarnings, setSchemaWarnings] = useState<string[]>([]);
  const [schemaDiff, setSchemaDiff] = useState<ReturnType<typeof compareSchemaRows> | null>(null);
  const [schemaJobs, setSchemaJobs] = useState<SchemaJob[]>([]);

  const refreshJobs = useCallback(async () => {
    if (!activeConnection || !window.janusGraphDesktop) {
      setSchemaJobs([]);
      return;
    }
    setSchemaJobs(await window.janusGraphDesktop.schemaJobs.list(activeConnection.id));
  }, [activeConnection?.id]);

  const refresh = useCallback(async () => {
    if (!activeConnection) return;
    setState({ status: "loading" });
    setSchemaWarnings([]);
    try {
      const results: QueryExecutionResult[] = [];
      const warnings: string[] = [];
      for (const script of schemaOverviewScripts(activeConnection)) {
        try {
          results.push(await execute(script.query));
        } catch (error) {
          warnings.push(`${script.label}: ${errorMessage(error)}`);
        }
      }
      if (results.length === 0) {
        throw new Error(warnings.join("\n") || t("无法读取当前图 Schema", "Unable to read the active graph schema"));
      }
      const items = results.flatMap((result) => result.items);
      const result: QueryExecutionResult = {
        executionId: results.map((entry) => entry.executionId).join(","),
        durationMs: results.reduce((total, entry) => total + entry.durationMs, 0),
        items,
        truncated: results.some((entry) => entry.truncated),
        totalCount: items.length,
      };
      localStorage.setItem(
        `janusgraph.schemaCatalog.v1.${activeConnection.id}`,
        JSON.stringify(schemaCatalogFromRows(result.items)),
      );
      setSchemaWarnings(warnings);
      setState({
        status: "success",
        result,
      });
    } catch (error) {
      setState({ status: "error", message: errorMessage(error) });
    }
  }, [activeConnection, execute, t]);

  useEffect(() => {
    if (activeConnection) {
      void refresh();
      void refreshJobs();
    }
  }, [activeConnection?.id]);

  const create = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!activeConnection) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const name = String(data.get("name") ?? "").trim();
    const graph = safeIdentifier(activeConnection.graphBinding);
    let script = "";
    if (kind === "property") {
      const dataType = String(data.get("dataType") ?? "String");
      const cardinality = String(data.get("cardinality") ?? "SINGLE");
      const createComposite = data.get("createComposite") === "on";
      const createMixed = data.get("createMixed") === "on";
      const compositeIndexName = String(
        data.get("compositeIndexName") ?? "",
      ).trim();
      const mixedIndexName = String(data.get("mixedIndexName") ?? "").trim();
      const indexElement =
        String(data.get("indexElement") ?? "Vertex") === "Edge"
          ? "Edge"
          : "Vertex";
      const backend = String(data.get("mixedIndexBackend") ?? "search").trim();
      const unique = data.get("compositeUnique") === "on";
      const indexScripts = [
        createComposite
          ? `compositeBuilder = mgmt.buildIndex(${stringLiteral(compositeIndexName)}, org.apache.tinkerpop.gremlin.structure.${indexElement}.class).addKey(key)
${unique ? "compositeBuilder.unique()" : ""}
compositeBuilder.buildCompositeIndex()`
          : "",
        createMixed
          ? `mgmt.buildIndex(${stringLiteral(mixedIndexName)}, org.apache.tinkerpop.gremlin.structure.${indexElement}.class).addKey(key).buildMixedIndex(${stringLiteral(backend)})`
          : "",
      ]
        .filter(Boolean)
        .join("\n");
      script = `mgmt = ${graph}.openManagement()
key = mgmt.makePropertyKey(${stringLiteral(name)}).dataType(${dataType}.class).cardinality(org.janusgraph.core.Cardinality.${cardinality}).make()
${indexScripts}
mgmt.commit()
${stringLiteral(`PropertyKey ${name} created`)}`;
    } else if (kind === "vertex") {
      script = `mgmt = ${graph}.openManagement()
mgmt.makeVertexLabel(${stringLiteral(name)}).make()
mgmt.commit()
${stringLiteral(`VertexLabel ${name} created`)}`;
    } else if (kind === "edge") {
      const multiplicity = String(data.get("multiplicity") ?? "MULTI");
      script = `mgmt = ${graph}.openManagement()
mgmt.makeEdgeLabel(${stringLiteral(name)}).multiplicity(org.janusgraph.core.Multiplicity.${multiplicity}).make()
mgmt.commit()
${stringLiteral(`EdgeLabel ${name} created`)}`;
    } else {
      const propertyKey = String(data.get("propertyKey") ?? "").trim();
      const indexType = String(data.get("existingIndexType") ?? "composite");
      const backend = String(data.get("indexBackend") ?? "search").trim();
      const indexElement =
        String(data.get("indexElement") ?? "Vertex") === "Edge"
          ? "Edge"
          : "Vertex";
      const unique = data.get("unique") === "on";
      const buildIndex =
        indexType === "mixed"
          ? `mgmt.buildIndex(${stringLiteral(name)}, org.apache.tinkerpop.gremlin.structure.${indexElement}.class).addKey(key).buildMixedIndex(${stringLiteral(backend)})`
          : `builder = mgmt.buildIndex(${stringLiteral(name)}, org.apache.tinkerpop.gremlin.structure.${indexElement}.class).addKey(key)
${unique ? "builder.unique()" : ""}
builder.buildCompositeIndex()`;
      script = `mgmt = ${graph}.openManagement()
key = mgmt.getPropertyKey(${stringLiteral(propertyKey)})
if (key == null) { throw new IllegalArgumentException("PropertyKey not found") }
${buildIndex}
mgmt.commit()
${stringLiteral(`${indexType} index ${name} created`)}`;
    }
    setBusy(true);
    try {
      await execute(script);
      form.reset();
      setPropertyComposite(false);
      setPropertyMixed(false);
      setExistingIndexType("composite");
      await refresh();
    } catch (error) {
      setState({ status: "error", message: errorMessage(error) });
    } finally {
      setBusy(false);
    }
  };

  const updateIndex = async (name: string, action: string) => {
    if (!activeConnection) return;
    if (action === "REMOVE_INDEX" && !window.confirm(t(
      `确认永久删除索引 ${name}？只有已禁用索引才能删除。`,
      `Permanently remove index ${name}? Only disabled indexes can be removed.`,
    ))) return;
    const graph = safeIdentifier(activeConnection.graphBinding);
    setIndexBusy(`${name}:${action}`);
    try {
      const lifecycleQuery = `mgmt = ${graph}.openManagement()
index = mgmt.getGraphIndex(${stringLiteral(name)})
if (index == null) { mgmt.rollback(); throw new IllegalArgumentException("GraphIndex not found") }
future = mgmt.updateIndex(index, org.janusgraph.core.schema.SchemaAction.${action})
mgmt.commit()
future.get()
${stringLiteral(`Index ${name}: ${action}`)}`;
      if (!window.janusGraphDesktop) throw new Error("Desktop API unavailable");
      await window.janusGraphDesktop.schemaJobs.run({
        connectionId: activeConnection.id,
        indexName: name,
        action,
        query: lifecycleQuery,
      });
      await refreshJobs();
      await refresh();
    } catch (error) {
      await refreshJobs().catch(() => undefined);
      setState({ status: "error", message: errorMessage(error) });
    } finally {
      setIndexBusy("");
    }
  };

  const schemaSnapshotKey = activeConnection
    ? `janusgraph.schemaSnapshot.v1.${activeConnection.id}`
    : "";
  const saveSchemaSnapshot = () => {
    if (!schemaSnapshotKey || state.status !== "success") return;
    localStorage.setItem(schemaSnapshotKey, JSON.stringify(schemaSnapshotRows(state.result.items)));
    setSchemaDiff({ added: [], removed: [], changed: [] });
  };
  const compareSchemaSnapshot = () => {
    if (!schemaSnapshotKey || state.status !== "success") return;
    try {
      const previous = JSON.parse(localStorage.getItem(schemaSnapshotKey) ?? "[]") as Record<string, unknown>[];
      if (!Array.isArray(previous) || previous.length === 0) {
        setSchemaDiff(null);
        return;
      }
      setSchemaDiff(compareSchemaRows(previous, schemaSnapshotRows(state.result.items)));
    } catch {
      setSchemaDiff(null);
    }
  };

  return (
    <div className="page-scroll">
      <PageHeader
        eyebrow="JANUSGRAPH MANAGEMENT"
        title={t("Schema 管理")}
        description={t(
          "结构化展示 Vertex Label、Edge Label、Property Key 和 Graph Index；支持 Composite 与 Mixed Index。",
          "Inspect Vertex Labels, Edge Labels, Property Keys and Graph Indexes; create Composite and Mixed indexes.",
        )}
        actions={
          <div className="schema-header-actions">
            <button type="button" className="button text" onClick={saveSchemaSnapshot} disabled={state.status !== "success"}>
              <Save size={16} />
              {t("保存快照", "Save snapshot")}
            </button>
            <button type="button" className="button text" onClick={compareSchemaSnapshot} disabled={state.status !== "success"}>
              <GitBranch size={16} />
              {t("比较快照", "Compare snapshot")}
            </button>
            <button
              type="button"
              className="button secondary"
              onClick={refresh}
              disabled={!activeConnection || state.status === "loading"}
            >
              <RefreshCw className={state.status === "loading" ? "spin" : ""} size={17} />
              {t("刷新 Schema")}
            </button>
          </div>
        }
      />
      {!activeConnection ? (
        <EmptyState
          icon={<Layers3 size={31} />}
          title={t("未选择连接")}
          description={t(
            "选择一个 JanusGraph 连接后才能读取或修改 Schema。",
            "Select a JanusGraph connection to inspect or modify its schema.",
          )}
        />
      ) : (
        <div className="schema-layout">
          <section className="surface schema-overview">
            <header className="surface-header">
              <div>
                <span className="eyebrow">CURRENT SCHEMA</span>
                <strong>{activeConnection.name}</strong>
                <small className="schema-binding">
                  Management: {activeConnection.graphBinding} · g →{" "}
                  {activeConnection.traversalSource}
                </small>
              </div>
            </header>
            <div className="surface-body">
              {state.status === "idle" && (
                <EmptyState
                  icon={<Search size={29} />}
                  title={t("尚未读取 Schema")}
                  description={t(
                    "点击“刷新 Schema”从服务器获取最新定义。",
                    "Refresh to load the latest definitions from the server.",
                  )}
                />
              )}
              {state.status === "loading" && (
                <div className="loading-state">
                  <LoaderCircle className="spin" size={27} />
                  <strong>{t("正在读取 Management API", "Reading Management API")}</strong>
                </div>
              )}
              {state.status === "error" && (
                <EmptyState
                  icon={<AlertTriangle size={29} />}
                  title={t("Schema 操作失败")}
                  description={state.message}
                  action={
                    <button type="button" className="button secondary" onClick={refresh}>
                      {t("重试")}
                    </button>
                  }
                />
              )}
              {state.status === "success" && (
                <>
                  {schemaWarnings.length > 0 && (
                    <div className="schema-partial-warning" role="status">
                      <AlertTriangle size={17} />
                      <div>
                        <strong>{t("部分 Schema 分组读取失败", "Some schema groups could not be loaded")}</strong>
                        <small>{schemaWarnings.join(" · ")}</small>
                      </div>
                    </div>
                  )}
                  {schemaDiff && (
                    <div className="schema-diff-summary">
                      <GitBranch size={17} />
                      <strong>{t("与已保存快照比较", "Compared with saved snapshot")}</strong>
                      <span className="is-added">+{schemaDiff.added.length}</span>
                      <span className="is-changed">~{schemaDiff.changed.length}</span>
                      <span className="is-removed">−{schemaDiff.removed.length}</span>
                      <small title={[...schemaDiff.added, ...schemaDiff.changed, ...schemaDiff.removed].join("\n")}>{t("悬停查看变更键", "Hover to inspect changed keys")}</small>
                    </div>
                  )}
                  <SchemaOverview
                    items={state.result.items}
                    onIndexAction={(name, action) => void updateIndex(name, action)}
                    indexBusy={indexBusy}
                  />
                  {schemaJobs.length > 0 && (
                    <section className="schema-job-audit" aria-label={t("Schema 任务审计", "Schema job audit")}>
                      <header>
                        <div>
                          <span className="eyebrow">SCHEMA JOBS</span>
                          <strong>{t("操作记录与恢复", "Operations and recovery")}</strong>
                        </div>
                        <button type="button" className="button text" onClick={() => void refreshJobs()}>
                          <RefreshCw size={15} />{t("刷新", "Refresh")}
                        </button>
                      </header>
                      <div className="schema-job-list">
                        {schemaJobs.slice(0, 8).map((job) => (
                          <article key={job.id} data-status={job.status}>
                            <span className="schema-job-status" />
                            <div>
                              <strong>{job.indexName}</strong>
                              <small>{job.action} · {new Date(job.createdAt).toLocaleString()}</small>
                              {job.message && <p>{job.message}</p>}
                            </div>
                            {(job.status === "failed" || job.status === "interrupted") && (
                              <button type="button" onClick={async () => {
                                if (!window.janusGraphDesktop) return;
                                setIndexBusy(`${job.indexName}:${job.action}`);
                                try {
                                  await window.janusGraphDesktop.schemaJobs.retry(job.id);
                                  await refreshJobs();
                                  await refresh();
                                } catch (error) {
                                  setState({ status: "error", message: errorMessage(error) });
                                  await refreshJobs();
                                } finally {
                                  setIndexBusy("");
                                }
                              }}>
                                <RotateCcw size={14} />{t("重试", "Retry")}
                              </button>
                            )}
                          </article>
                        ))}
                      </div>
                    </section>
                  )}
                </>
              )}
            </div>
          </section>
          <section className="surface schema-create">
            <header className="surface-header">
              <div>
                <span className="eyebrow">CREATE SCHEMA</span>
                <strong>{t("新建定义")}</strong>
              </div>
            </header>
            <form className="schema-form" onSubmit={create}>
              <label className="field">
                <span>{t("类型")}</span>
                <SelectControl
                  ariaLabel={t("类型")}
                  value={kind}
                  onValueChange={(value) => setKind(value as typeof kind)}
                  options={[
                    { value: "property", label: "Property Key" },
                    { value: "vertex", label: "Vertex Label" },
                    { value: "edge", label: "Edge Label" },
                    {
                      value: "index",
                      label: t(
                        "为已有属性创建索引",
                        "Index Existing Property",
                      ),
                    },
                  ]}
                />
              </label>
              <label className="field">
                <span>{t("名称")}</span>
                <input name="name" required maxLength={120} />
              </label>
              {kind === "property" && (
                <>
                  <label className="field">
                    <span>{t("数据类型")}</span>
                    <SelectControl
                      name="dataType"
                      ariaLabel={t("数据类型")}
                      defaultValue="String"
                      options={["String", "Integer", "Long", "Double", "Boolean", "Date"].map(
                        (value) => ({ value, label: value }),
                      )}
                    />
                  </label>
                  <label className="field">
                    <span>Cardinality</span>
                    <SelectControl
                      name="cardinality"
                      ariaLabel="Cardinality"
                      defaultValue="SINGLE"
                      options={["SINGLE", "LIST", "SET"].map((value) => ({
                        value,
                        label: value,
                      }))}
                    />
                  </label>
                  <div
                    className="property-index-builder field-span-2"
                    role="group"
                    aria-labelledby="property-index-builder-title"
                  >
                    <div
                      className="property-index-heading"
                      id="property-index-builder-title"
                    >
                      {t(
                        "随属性同步创建索引",
                        "Create indexes with this property",
                      )}
                    </div>
                    <div className="index-type-grid">
                      <label className="index-type-choice">
                        <input
                          type="checkbox"
                          name="createComposite"
                          checked={propertyComposite}
                          onChange={(event) =>
                            setPropertyComposite(event.target.checked)
                          }
                        />
                        <span>
                          <b>C</b>
                          <strong>Composite Index</strong>
                          <small>
                            {t(
                              "精确匹配与唯一约束",
                              "Exact lookup and uniqueness",
                            )}
                          </small>
                        </span>
                      </label>
                      <label className="index-type-choice">
                        <input
                          type="checkbox"
                          name="createMixed"
                          checked={propertyMixed}
                          onChange={(event) =>
                            setPropertyMixed(event.target.checked)
                          }
                        />
                        <span>
                          <b>M</b>
                          <strong>Mixed Index</strong>
                          <small>
                            {t(
                              "全文、范围和搜索后端",
                              "Text, range and search backend",
                            )}
                          </small>
                        </span>
                      </label>
                    </div>
                    {(propertyComposite || propertyMixed) && (
                      <label className="field index-element-field">
                        <span>{t("索引元素", "Indexed element")}</span>
                        <SelectControl
                          name="indexElement"
                          ariaLabel={t("索引元素", "Indexed element")}
                          defaultValue="Vertex"
                          options={[
                            { value: "Vertex", label: "Vertex" },
                            { value: "Edge", label: "Edge" },
                          ]}
                        />
                      </label>
                    )}
                    {(propertyComposite || propertyMixed) && (
                      <div className="property-index-settings">
                        {propertyComposite && (
                          <section className="property-index-config">
                            <header>
                              <b>C</b>
                              <strong>
                                {t("Composite 配置", "Composite settings")}
                              </strong>
                            </header>
                            <label className="field">
                              <span>Composite Index Name</span>
                              <input
                                name="compositeIndexName"
                                required
                                maxLength={120}
                              />
                            </label>
                            <label className="check-field">
                              <input type="checkbox" name="compositeUnique" />
                              <span>
                                <strong>{t("唯一索引", "Unique index")}</strong>
                                <small>
                                  {t("仅 Composite 支持", "Composite only")}
                                </small>
                              </span>
                            </label>
                          </section>
                        )}
                        {propertyMixed && (
                          <section className="property-index-config">
                            <header>
                              <b>M</b>
                              <strong>
                                {t("Mixed 配置", "Mixed settings")}
                              </strong>
                            </header>
                            <label className="field">
                              <span>Mixed Index Name</span>
                              <input
                                name="mixedIndexName"
                                required
                                maxLength={120}
                              />
                            </label>
                            <label className="field">
                              <span>
                                {t(
                                  "Mixed Index 后端",
                                  "Mixed index backend",
                                )}
                              </span>
                              <input
                                name="mixedIndexBackend"
                                defaultValue="search"
                                required
                              />
                            </label>
                          </section>
                        )}
                      </div>
                    )}
                  </div>
                </>
              )}
              {kind === "edge" && (
                <label className="field">
                  <span>Multiplicity</span>
                  <SelectControl
                    name="multiplicity"
                    ariaLabel="Multiplicity"
                    defaultValue="MULTI"
                    options={["MULTI", "SIMPLE", "MANY2ONE", "ONE2MANY", "ONE2ONE"].map(
                      (value) => ({ value, label: value }),
                    )}
                  />
                </label>
              )}
              {kind === "index" && (
                <>
                  <label className="field">
                    <span>Property Key</span>
                    <input name="propertyKey" required />
                  </label>
                  <label className="field">
                    <span>{t("索引类型", "Index type")}</span>
                    <SelectControl
                      name="existingIndexType"
                      ariaLabel={t("索引类型", "Index type")}
                      value={existingIndexType}
                      onValueChange={(value) =>
                        setExistingIndexType(value as typeof existingIndexType)
                      }
                      options={[
                        { value: "composite", label: "Composite Index" },
                        { value: "mixed", label: "Mixed Index" },
                      ]}
                    />
                  </label>
                  <IndexFields mixed={existingIndexType === "mixed"} t={t} />
                </>
              )}
              <div className="schema-warning">
                <ShieldCheck size={18} />
                <span>
                  {t(
                    "提交后会立即修改服务器 Schema，请确认当前连接和名称。",
                    "This commits directly to the active graph. Verify the connection and names.",
                  )}
                </span>
              </div>
              <button type="submit" className="button primary" disabled={busy}>
                {busy ? (
                  <LoaderCircle className="spin" size={17} />
                ) : (
                  <Plus size={17} />
                )}
                {t("创建")}
              </button>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}

function TransferPage({
  activeConnection,
  execute,
  notify,
}: {
  activeConnection: ConnectionSummary | undefined;
  execute: (
    query: string,
    bindings?: Record<string, unknown>,
    recordHistory?: boolean,
  ) => Promise<QueryExecutionResult>;
  notify: (toast: ToastState) => void;
}) {
  const t = useTranslate();
  const [file, setFile] = useState<PickedDataFile | null>(null);
  const [archive, setArchive] = useState<GraphArchive | null>(null);
  const [busy, setBusy] = useState<"import" | "export" | null>(null);
  const [batchSize, setBatchSize] = useState(100);
  const [continueOnError, setContinueOnError] = useState(false);
  const [conflictPolicy, setConflictPolicy] = useState<"append" | "skip">("append");
  const [identityProperty, setIdentityProperty] = useState("_observatorySourceId");
  const [failures, setFailures] = useState<Array<{
    phase: string;
    offset: number;
    message: string;
  }>>([]);
  const cancelTransferRef = useRef(false);
  const [progress, setProgress] = useState({
    phase: "",
    completed: 0,
    total: 0,
  });

  const pick = async () => {
    if (!window.janusGraphDesktop) return;
    try {
      const picked = await window.janusGraphDesktop.files.pickDataFile();
      if (!picked) return;
      const parsed = parseGraphArchive(picked);
      setFile(picked);
      setArchive(parsed);
      notify({
        tone: "success",
        message: t(
          `已读取 ${parsed.vertices.length} 个顶点、${parsed.edges.length} 条边`,
          `Loaded ${parsed.vertices.length} vertices and ${parsed.edges.length} edges`,
        ),
      });
    } catch (error) {
      notify({ tone: "error", message: errorMessage(error) });
    }
  };

  const importGraph = async () => {
    if (!activeConnection || !archive) return;
    setBusy("import");
    setFailures([]);
    cancelTransferRef.current = false;
    setProgress({
      phase: t("正在创建顶点", "Creating vertices"),
      completed: 0,
      total: archive.vertices.length + archive.edges.length,
    });
    try {
      const idMap = new Map<string, unknown>();
      for (
        let index = 0;
        index < archive.vertices.length;
        index += batchSize
      ) {
        if (cancelTransferRef.current) break;
        const rows = archive.vertices
          .slice(index, index + batchSize)
          .map((vertex) => ({
            sourceId: vertex.id,
            label: vertex.label,
            properties: vertex.properties,
            conflictPolicy,
            identityProperty,
          }));
        try {
          const response = await execute(
          `rows.collect { row ->
  def existing = row.conflictPolicy == "skip" ? g.V().has(row.identityProperty.toString(), row.sourceId).tryNext().orElse(null) : null
  if (existing != null) return [sourceId: row.sourceId, targetId: existing.id()]
  def traversal = g.addV(row.label.toString())
  if (row.conflictPolicy == "skip") traversal = traversal.property(row.identityProperty.toString(), row.sourceId)
  row.properties.each { key, value ->
    if (value instanceof Collection) {
      value.each { item ->
        if (item != null) traversal = traversal.property(key.toString(), item)
      }
    } else if (value != null) {
      traversal = traversal.property(key.toString(), value)
    }
  }
  def vertex = traversal.next()
  [sourceId: row.sourceId, targetId: vertex.id()]
}`,
          { rows },
          false,
        );
          response.items.map(decodeGraphValue).forEach((value) => {
            if (!value || typeof value !== "object" || Array.isArray(value)) return;
            const mapping = value as Record<string, unknown>;
            if (mapping.sourceId !== undefined && mapping.targetId !== undefined) {
              idMap.set(String(mapping.sourceId), mapping.targetId);
            }
          });
        } catch (error) {
          setFailures((current) => [...current, {
            phase: "vertices",
            offset: index,
            message: errorMessage(error),
          }]);
          if (!continueOnError) throw error;
        }
        setProgress((current) => ({
          ...current,
          completed: Math.min(index + rows.length, archive.vertices.length),
        }));
      }

      setProgress((current) => ({
        ...current,
        phase: t("正在创建关系", "Creating edges"),
      }));
      for (let index = 0; index < archive.edges.length; index += batchSize) {
        if (cancelTransferRef.current) break;
        try {
          const rows = archive.edges
          .slice(index, index + batchSize)
          .map((edge) => {
            const fromId = idMap.get(edge.from);
            const toId = idMap.get(edge.to);
            if (fromId === undefined || toId === undefined) {
              throw new Error(`关系 ${edge.id} 引用了归档中不存在的顶点`);
            }
            return {
              label: edge.label,
              fromId,
              toId,
              properties: edge.properties,
            };
          });
          await execute(
          `rows.each { row ->
  def traversal = g.V(row.fromId).addE(row.label.toString()).to(g.V(row.toId))
  row.properties.each { key, value ->
    if (value instanceof Collection) {
      value.each { item ->
        if (item != null) traversal = traversal.property(key.toString(), item)
      }
    } else if (value != null) {
      traversal = traversal.property(key.toString(), value)
    }
  }
  traversal.iterate()
}
rows.size()`,
          { rows },
          false,
        );
          setProgress((current) => ({
            ...current,
            completed:
              archive.vertices.length +
              Math.min(index + rows.length, archive.edges.length),
          }));
        } catch (error) {
          setFailures((current) => [...current, {
            phase: "edges",
            offset: index,
            message: errorMessage(error),
          }]);
          if (!continueOnError) throw error;
        }
      }
      notify({
        tone: cancelTransferRef.current ? "info" : "success",
        message: cancelTransferRef.current
          ? t(
              "导入已在当前批次完成后停止，已写入的数据不会自动回滚。",
              "Import stopped after the current batch. Previously written data was not rolled back.",
            )
          : t(
              `整图导入完成：${archive.vertices.length} 个顶点、${archive.edges.length} 条边`,
              `Graph import complete: ${archive.vertices.length} vertices and ${archive.edges.length} edges`,
            ),
      });
    } catch (error) {
      setFailures((current) => current.length > 0 ? current : [{
        phase: "import",
        offset: progress.completed,
        message: errorMessage(error),
      }]);
      notify({ tone: "error", message: errorMessage(error) });
    } finally {
      setBusy(null);
    }
  };

  const exportGraph = async () => {
    if (!activeConnection || !window.janusGraphDesktop) return;
    setBusy("export");
    setFailures([]);
    cancelTransferRef.current = false;
    setProgress({ phase: t("正在统计图数据", "Counting graph data"), completed: 0, total: 0 });
    try {
      const [vertexCountResult, edgeCountResult] = await Promise.all([
        execute("g.V().count()", {}, false),
        execute("g.E().count()", {}, false),
      ]);
      const vertexCount = Number(decodeGraphValue(vertexCountResult.items[0]) ?? 0);
      const edgeCount = Number(decodeGraphValue(edgeCountResult.items[0]) ?? 0);
      const total = vertexCount + edgeCount;
      setProgress({
        phase: t("正在导出顶点", "Exporting vertices"),
        completed: 0,
        total,
      });
      const vertices = new Map<string, GraphArchive["vertices"][number]>();
      const edges = new Map<string, GraphArchive["edges"][number]>();
      const exportBatchSize = Math.max(250, batchSize * 4);
      for (let offset = 0; offset < vertexCount; offset += exportBatchSize) {
        if (cancelTransferRef.current) break;
        const response = await execute(
          `g.V().range(${offset}, ${Math.min(offset + exportBatchSize, vertexCount)}).elementMap()`,
          {},
          false,
        );
        const model = buildGraphModel(response.items);
        model.nodes.forEach((vertex) => vertices.set(vertex.id, vertex));
        setProgress((current) => ({
          ...current,
          completed: Math.min(offset + exportBatchSize, vertexCount),
        }));
      }
      setProgress((current) => ({
        ...current,
        phase: t("正在导出关系", "Exporting edges"),
      }));
      for (let offset = 0; offset < edgeCount; offset += exportBatchSize) {
        if (cancelTransferRef.current) break;
        const response = await execute(
          `g.E().range(${offset}, ${Math.min(offset + exportBatchSize, edgeCount)}).elementMap()`,
          {},
          false,
        );
        const model = buildGraphModel(response.items);
        model.edges.forEach((edge) => edges.set(edge.id, edge));
        setProgress((current) => ({
          ...current,
          completed:
            vertexCount + Math.min(offset + exportBatchSize, edgeCount),
        }));
      }
      if (cancelTransferRef.current) {
        notify({
          tone: "info",
          message: t(
            "导出已停止，未生成不完整归档。",
            "Export stopped; no partial archive was created.",
          ),
        });
        return;
      }
      const graphArchive: GraphArchive = {
        format: "janusgraph-observatory.graph/v1",
        exportedAt: new Date().toISOString(),
        vertices: [...vertices.values()],
        edges: [...edges.values()],
      };
      const path = await window.janusGraphDesktop.files.saveDataFile({
        suggestedName: `janusgraph-graph-${Date.now()}.json`,
        format: "json",
        content: JSON.stringify(graphArchive),
      });
      if (path) {
        notify({
          tone: "success",
          message: t(`整图归档已保存到 ${path}`, `Graph archive saved to ${path}`),
        });
      }
    } catch (error) {
      setFailures([{
        phase: "export",
        offset: progress.completed,
        message: errorMessage(error),
      }]);
      notify({ tone: "error", message: errorMessage(error) });
    } finally {
      setBusy(null);
    }
  };

  const exportFailureLog = async () => {
    if (!window.janusGraphDesktop || failures.length === 0) return;
    try {
      await window.janusGraphDesktop.files.saveDataFile({
        suggestedName: `janusgraph-transfer-failures-${Date.now()}.json`,
        format: "json",
        content: JSON.stringify(failures, null, 2),
      });
    } catch (error) {
      notify({ tone: "error", message: errorMessage(error) });
    }
  };

  return (
    <div className="page-scroll">
      <PageHeader
        eyebrow="DATA TRANSFER"
        title={t("导入与导出")}
        description={t(
          "以可移植 JSON 归档导入或导出完整图数据，包括顶点、关系及其属性。查询结果导出已移至查询结果工具栏。",
          "Import or export complete graph data as a portable JSON archive, including vertices, edges and properties. Query-result export now lives in the result toolbar.",
        )}
      />
      <div className="transfer-grid">
        <section className="surface transfer-card">
          <header className="surface-header">
            <div>
              <span className="eyebrow">IMPORT</span>
              <strong>{t("导入完整图归档", "Import complete graph archive")}</strong>
            </div>
            <Upload size={20} />
          </header>
          <div className="transfer-content">
            <button type="button" className="file-drop" onClick={pick}>
              <FileUp size={28} />
              <strong>{file?.name ?? t("选择图归档 JSON", "Choose a graph archive JSON")}</strong>
              <span>
                {t(
                  "支持最高 200 MB 的 Observatory v1 图归档",
                  "Supports Observatory v1 graph archives up to 200 MB",
                )}
              </span>
            </button>
            {archive && (
              <>
                <div className="import-summary">
                  <span>{archive.vertices.length.toLocaleString()} V</span>
                  <span>{archive.edges.length.toLocaleString()} E</span>
                  <span>OBSERVATORY V1</span>
                </div>
                <div className="transfer-preview-list" aria-label={t("归档预览", "Archive preview")}>
                  {archive.vertices.slice(0, 3).map((vertex) => (
                    <div key={`v:${vertex.id}`}>
                      <CircleDot size={15} />
                      <strong>{vertex.label}</strong>
                      <code>{vertex.id}</code>
                      <small>{Object.keys(vertex.properties).length} properties</small>
                    </div>
                  ))}
                  {archive.edges.slice(0, 2).map((edge) => (
                    <div key={`e:${edge.id}`}>
                      <Waypoints size={15} />
                      <strong>{edge.label}</strong>
                      <code>{edge.from} → {edge.to}</code>
                      <small>{Object.keys(edge.properties).length} properties</small>
                    </div>
                  ))}
                </div>
                <div className="transfer-options">
                  <label className="field">
                    <span>{t("批次大小", "Batch size")}</span>
                    <SelectControl
                      ariaLabel={t("导入批次大小", "Import batch size")}
                      value={String(batchSize)}
                      onValueChange={(value) => setBatchSize(Number(value))}
                      options={[25, 50, 100, 250].map((value) => ({ value: String(value), label: String(value) }))}
                    />
                  </label>
                  <label className="field">
                    <span>{t("冲突策略", "Conflict policy")}</span>
                    <SelectControl
                      ariaLabel={t("冲突策略", "Conflict policy")}
                      value={conflictPolicy}
                      onValueChange={(value) => setConflictPolicy(value as typeof conflictPolicy)}
                      options={[
                        { value: "append", label: t("追加新元素", "Append new elements") },
                        { value: "skip", label: t("按来源 ID 跳过已有顶点", "Skip vertices by source ID") },
                      ]}
                    />
                  </label>
                  {conflictPolicy === "skip" && (
                    <label className="field field-span-2">
                      <span>{t("来源 ID 属性键", "Source ID property key")}</span>
                      <input value={identityProperty} onChange={(event) => setIdentityProperty(event.target.value)} required />
                      <small>{t("该 Property Key 必须已存在于 Schema；首次导入会写入来源 ID。", "This Property Key must already exist in schema; source IDs are written during the first import.")}</small>
                    </label>
                  )}
                  <label className="check-field field-span-2">
                    <input type="checkbox" checked={continueOnError} onChange={(event) => setContinueOnError(event.target.checked)} />
                    <span>
                      <strong>{t("记录失败并继续下一批", "Log failures and continue")}</strong>
                      <small>{t("适合容错迁移；失败批次可在操作后导出。", "Useful for tolerant migrations; failed batches can be exported afterwards.")}</small>
                    </span>
                  </label>
                </div>
                <button
                  type="button"
                  className="button primary"
                  disabled={Boolean(busy) || !activeConnection}
                  onClick={() => void importGraph()}
                >
                  {busy === "import" ? (
                    <LoaderCircle className="spin" size={17} />
                  ) : (
                    <Upload size={17} />
                  )}
                  {t("导入整图到", "Import complete graph to")} {activeConnection?.name ?? t("未选择连接")}
                </button>
              </>
            )}
          </div>
        </section>
        <section className="surface transfer-card">
          <header className="surface-header">
            <div>
              <span className="eyebrow">EXPORT</span>
              <strong>{t("导出完整图数据", "Export complete graph data")}</strong>
            </div>
            <Download size={20} />
          </header>
          <div className="transfer-content">
            <div className="export-metric">
              <Database size={28} />
              <strong>{t("VERTICES + EDGES", "VERTICES + EDGES")}</strong>
              <span>{t("保留 Label、属性和关系方向", "Preserves labels, properties and edge directions")}</span>
            </div>
            <button
              type="button"
              className="export-option"
              disabled={Boolean(busy) || !activeConnection}
              onClick={() => void exportGraph()}
            >
              {busy === "export" ? <LoaderCircle className="spin" size={22} /> : <FileJson size={22} />}
              <span>
                <strong>{t("创建整图 JSON 归档", "Create complete graph JSON archive")}</strong>
                <small>{t(`大图会按 ${Math.max(250, batchSize * 4)} 个元素分批读取`, `Large graphs are read in batches of ${Math.max(250, batchSize * 4)} elements`)}</small>
              </span>
              <Download size={17} />
            </button>
            <small className="transfer-note">
              {t(
                "超过 200 MB 或生产级迁移仍建议使用 JanusGraph Bulk Loading 工具链。",
                "For archives above 200 MB or production migration, use the JanusGraph bulk-loading toolchain.",
              )}
            </small>
          </div>
        </section>
      </div>
      {busy && (
        <section className="transfer-progress" aria-live="polite">
          <div>
            <LoaderCircle className="spin" size={17} />
            <strong>{progress.phase}</strong>
            <span>
              {progress.total
                ? `${progress.completed.toLocaleString()} / ${progress.total.toLocaleString()}`
                : t("准备中", "Preparing")}
            </span>
            <button type="button" className="button danger" onClick={() => { cancelTransferRef.current = true; }}>
              <Square size={14} fill="currentColor" />
              {t("当前批次后停止", "Stop after batch")}
            </button>
          </div>
          <progress max={Math.max(progress.total, 1)} value={progress.completed} />
        </section>
      )}
      {failures.length > 0 && (
        <section className="transfer-failures" role="alert">
          <AlertTriangle size={18} />
          <div>
            <strong>{t(`${failures.length} 个批次失败`, `${failures.length} batches failed`)}</strong>
            <small>{failures.at(-1)?.message}</small>
          </div>
          <button type="button" className="button secondary" onClick={() => void exportFailureLog()}>
            <Download size={16} />
            {t("导出失败日志", "Export failure log")}
          </button>
        </section>
      )}
    </div>
  );
}

function SettingSwitch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-label={label}
      aria-checked={checked}
      className={`switch ${checked ? "is-on" : ""}`}
      onClick={() => onChange(!checked)}
    >
      <span />
    </button>
  );
}

const SHORTCUT_OPTIONS: Array<{
  action: ShortcutAction;
  label: string;
  english: string;
}> = [
  { action: "openSettings", label: "打开偏好设置", english: "Open preferences" },
  { action: "saveQuery", label: "保存当前查询", english: "Save current query" },
  { action: "runQuery", label: "运行当前查询", english: "Run current query" },
  { action: "stopQuery", label: "停止当前查询", english: "Stop current query" },
  { action: "formatQuery", label: "格式化当前查询", english: "Format current query" },
  { action: "findReplace", label: "查找并替换", english: "Find and replace" },
  { action: "beginTransaction", label: "开启当前标签页事务", english: "Begin tab transaction" },
  { action: "commitTransaction", label: "提交当前标签页事务", english: "Commit tab transaction" },
  { action: "rollbackTransaction", label: "回滚当前标签页事务", english: "Rollback tab transaction" },
  { action: "newQueryTab", label: "新建查询标签页", english: "New query tab" },
  { action: "duplicateQueryTab", label: "复制当前标签页", english: "Duplicate current tab" },
  { action: "closeQueryTab", label: "关闭当前标签页", english: "Close current tab" },
  { action: "restoreClosedTab", label: "恢复关闭的标签页", english: "Reopen closed tab" },
  { action: "nextQueryTab", label: "切换到下一标签页", english: "Next query tab" },
  { action: "previousQueryTab", label: "切换到上一标签页", english: "Previous query tab" },
  { action: "toggleSidebar", label: "收起或展开侧栏", english: "Toggle sidebar" },
  { action: "toggleSuggestions", label: "显示或关闭输入建议", english: "Toggle suggestions" },
];

function ShortcutRecorder({
  label,
  value,
  conflict,
  onChange,
}: {
  label: string;
  value: string;
  conflict: boolean;
  onChange: (shortcut: string) => void;
}) {
  const t = useTranslate();
  const [recording, setRecording] = useState(false);
  return (
    <div className="shortcut-row">
      <div>
        <strong>{label}</strong>
        <small>
          {conflict
            ? t("与其他操作冲突，请重新输入", "Conflicts with another action")
            : t("点击后直接按下组合键", "Click, then press a key combination")}
        </small>
      </div>
      <button
        type="button"
        className={`shortcut-recorder ${recording ? "is-recording" : ""} ${conflict ? "has-conflict" : ""}`}
        aria-label={t(`设置${label}快捷键`, `Set shortcut for ${label}`)}
        onFocus={() => setRecording(true)}
        onBlur={() => setRecording(false)}
        onKeyDown={(event) => {
          event.preventDefault();
          event.stopPropagation();
          const shortcut = shortcutFromEvent(event.nativeEvent);
          if (!shortcut) return;
          onChange(shortcut);
          setRecording(false);
          event.currentTarget.blur();
        }}
      >
        <Keyboard size={16} />
        <kbd>{recording ? t("请按组合键", "Press shortcut") : shortcutLabel(value)}</kbd>
      </button>
    </div>
  );
}

function SettingsPage({
  settings,
  onChange,
}: {
  settings: AppSettings;
  onChange: (settings: AppSettings) => void;
}) {
  const t = useTranslate();
  const [activeSection, setActiveSection] = useState<
    "general" | "typography" | "graph" | "behavior" | "shortcuts" | "security"
  >("general");
  const [security, setSecurity] = useState<SecurityStorageStatus | null>(null);
  const update = <Key extends keyof AppSettings>(
    key: Key,
    value: AppSettings[Key],
  ) => onChange({ ...settings, [key]: value });
  const updateLayoutConfiguration = <
    Mode extends keyof GraphLayoutConfiguration,
  >(
    mode: Mode,
    patch: Partial<GraphLayoutConfiguration[Mode]>,
  ) =>
    update("graphLayoutConfiguration", {
      ...settings.graphLayoutConfiguration,
      [mode]: {
        ...settings.graphLayoutConfiguration[mode],
        ...patch,
      },
    });
  const shortcutConflicts = new Set(
    Object.values(settings.keyboardShortcuts).filter(
      (shortcut, index, values) =>
        shortcut && values.indexOf(shortcut) !== index,
    ),
  );

  useEffect(() => {
    if (activeSection !== "security") return;
    let mounted = true;
    const loadSecurityStatus = async () => {
      try {
        const api = window.janusGraphDesktop;
        if (!api) throw new Error("Desktop API unavailable");
        const status = await api.security.status();
        if (mounted) setSecurity(status);
      } catch {
        if (mounted) {
          setSecurity({
            mode: "local-fallback",
            osEncryptionAvailable: false,
            fallbackKeyPresent: false,
            description: "",
          });
        }
      }
    };
    void loadSecurityStatus();
    return () => {
      mounted = false;
    };
  }, [activeSection]);

  return (
    <div className="page-scroll settings-page">
      <PageHeader
        eyebrow="PREFERENCES"
        title={t("偏好设置")}
        description={t(
          "设置保存在当前电脑并立即生效。",
          "Settings are stored on this computer and apply immediately.",
        )}
        actions={
          <button
            type="button"
            className="button secondary"
            onClick={() => onChange(DEFAULT_SETTINGS)}
          >
            <RotateCcw size={17} />
            {t("恢复默认设置")}
          </button>
        }
      />
      <div className="settings-layout">
      <nav className="settings-subnav" aria-label={t("偏好设置分类", "Preference categories")}>
        {([
          ["general", t("常规", "General"), t("语言、主题与界面密度", "Language, theme and density"), <Languages size={18} />],
          ["typography", t("外观与字体", "Appearance & type"), t("界面与代码字号", "UI and editor typography"), <SlidersHorizontal size={18} />],
          ["graph", t("图谱", "Graph"), t("渲染、标签与布局", "Rendering, captions and layouts"), <Network size={18} />],
          ["behavior", t("编辑器", "Editor"), t("查询、历史与建议", "Queries, history and suggestions"), <Code2 size={18} />],
          ["shortcuts", t("快捷键", "Shortcuts"), t("键盘操作映射", "Keyboard command map"), <Keyboard size={18} />],
          ["security", t("安全", "Security"), t("凭据与本地加密", "Credentials and local encryption"), <LockKeyhole size={18} />],
        ] as const).map(([id, label, description, icon]) => (
          <button
            type="button"
            key={id}
            className={activeSection === id ? "is-active" : ""}
            aria-current={activeSection === id ? "page" : undefined}
            onClick={() => setActiveSection(id)}
          >
            <span>{icon}</span>
            <span><strong>{label}</strong><small>{description}</small></span>
          </button>
        ))}
      </nav>
      <div className="settings-grid">
      <section className="settings-group settings-general" hidden={activeSection !== "general"}>
        <header>
          <Languages size={21} />
          <div>
            <span className="eyebrow">GENERAL</span>
            <h2>{t("界面与可访问性")}</h2>
          </div>
        </header>
        <div className="settings-fields">
          <label className="field">
            <span>{t("界面语言")}</span>
            <SelectControl
              ariaLabel={t("界面语言")}
              value={settings.locale}
              onValueChange={(value) =>
                update("locale", value as AppSettings["locale"])
              }
              options={localizedLanguageOptions(settings.locale)}
            />
          </label>
          <label className="field">
            <span>{t("主题")}</span>
            <SelectControl
              ariaLabel={t("主题")}
              value={settings.theme}
              onValueChange={(value) =>
                update("theme", value as AppSettings["theme"])
              }
              options={[
                { value: "dark", label: t("深色") },
                { value: "light", label: t("浅色") },
                { value: "system", label: t("跟随系统") },
              ]}
            />
          </label>
          <div className="field settings-font-field">
            <span>{t("界面字体")}</span>
            <SelectControl
              ariaLabel={t("界面字体")}
              value={settings.fontFamily}
              onValueChange={(value) =>
                update(
                  "fontFamily",
                  value as AppSettings["fontFamily"],
                )
              }
              options={[
                {
                  value: "sans",
                  label: t("多语言无衬线", "Multilingual Sans"),
                  description: "Noto / PingFang / Segoe UI",
                },
                { value: "system", label: t("系统字体") },
                { value: "mono", label: t("等宽字体") },
                {
                  value: "humanist",
                  label: t("人文无衬线", "Humanist Sans"),
                  description: "Avenir Next / Segoe UI",
                },
                {
                  value: "technical",
                  label: t("技术展示体", "Technical Display"),
                  description: "Lexend + Noto multilingual fallback",
                },
                {
                  value: "editorial",
                  label: t("编辑无衬线", "Editorial Sans"),
                  description: "Aptos / Inter / Noto Sans",
                },
                {
                  value: "custom",
                  label: t("用户自定义字体", "Custom font"),
                  description: t("使用当前系统已安装字体", "Use a font installed on this system"),
                },
              ]}
            />
            {settings.fontFamily === "custom" && (
              <label className="font-custom-field">
                <span>{t("自定义界面字体", "Custom UI font")}</span>
                <input
                  value={settings.customUiFont}
                  onChange={(event) => update("customUiFont", event.target.value)}
                  placeholder='"HarmonyOS Sans SC", Inter'
                />
                <small>
                  {t(
                    "输入系统字体名称或 CSS 字体列表，修改后立即预览。",
                    "Enter an installed font name or CSS font list. Changes preview immediately.",
                  )}
                </small>
              </label>
            )}
          </div>
          <div className="field settings-font-field">
            <span>{t("代码与编辑器字体", "Code and editor font")}</span>
            <SelectControl
              ariaLabel={t("代码与编辑器字体", "Code and editor font")}
              value={settings.codeFontFamily}
              onValueChange={(value) =>
                update("codeFontFamily", value as AppSettings["codeFontFamily"])
              }
              options={[
                {
                  value: "jetbrains",
                  label: "JetBrains Mono",
                  description: t("清晰区分 0/O、1/l/I，默认推荐", "Clear 0/O and 1/l/I distinction; recommended"),
                },
                { value: "fira-code", label: "Fira Code", description: t("支持编程连字", "Programming ligatures") },
                { value: "source-code", label: "Source Code Pro", description: t("宽松、耐读", "Open and highly readable") },
                { value: "ibm-plex", label: "IBM Plex Mono" },
                { value: "system-mono", label: t("系统等宽字体", "System monospace") },
                { value: "custom", label: t("用户自定义字体", "Custom font") },
              ]}
            />
            {settings.codeFontFamily === "custom" && (
              <label className="font-custom-field">
                <span>{t("自定义代码字体", "Custom code font")}</span>
                <input
                  value={settings.customCodeFont}
                  onChange={(event) => update("customCodeFont", event.target.value)}
                  placeholder='"Maple Mono", "Cascadia Code"'
                />
                <small>
                  {t(
                    "可输入当前系统已安装的任意等宽字体。",
                    "Use any monospace font installed on this system.",
                  )}
                </small>
              </label>
            )}
          </div>
          <label className="field">
            <span>{t("界面密度")}</span>
            <SelectControl
              ariaLabel={t("界面密度")}
              value={settings.density}
              onValueChange={(value) =>
                update("density", value as AppSettings["density"])
              }
              options={[
                { value: "comfortable", label: t("舒适") },
                { value: "compact", label: t("紧凑") },
              ]}
            />
          </label>
        </div>
      </section>

      <section className="settings-group settings-typography" hidden={activeSection !== "typography"}>
        <header>
          <SlidersHorizontal size={21} />
          <div>
            <span className="eyebrow">DYNAMIC TYPE</span>
            <h2>{t("任意字体大小", "Flexible font sizing")}</h2>
          </div>
        </header>
        <label className="range-field">
          <span>
            <strong>{t("界面字号")}</strong>
            <output>{settings.uiFontSize}px</output>
          </span>
          <input
            type="range"
            min="11"
            max="30"
            step="1"
            value={settings.uiFontSize}
            onChange={(event) => update("uiFontSize", Number(event.target.value))}
          />
          <small>{t("支持 11–30px，所有布局随字号重新计算。", "11–30px. Layout dimensions adapt with the type scale.")}</small>
        </label>
        <label className="range-field">
          <span>
            <strong>{t("编辑器字号")}</strong>
            <output>{settings.editorFontSize}px</output>
          </span>
          <input
            type="range"
            min="12"
            max="40"
            step="1"
            value={settings.editorFontSize}
            onChange={(event) =>
              update("editorFontSize", Number(event.target.value))
            }
          />
          <small>{t("查询编辑器独立缩放，范围 12–40px。", "Independent editor scale from 12–40px.")}</small>
        </label>
      </section>

      <section className="settings-group settings-graph" hidden={activeSection !== "graph"}>
        <header>
          <Waypoints size={21} />
          <div>
            <span className="eyebrow">GRAPH CANVAS</span>
            <h2>{t("拓扑渲染")}</h2>
          </div>
        </header>
        <label className="field graph-layout-field">
          <span>{t("默认拓扑布局", "Default graph layout")}</span>
          <SelectControl
            ariaLabel={t("默认拓扑布局", "Default graph layout")}
            value={settings.graphLayout}
            onValueChange={(value) =>
              update("graphLayout", value as AppSettings["graphLayout"])
            }
            options={[
              {
                value: "force",
                label: t("力导向布局", "Force-directed"),
                description: t("适合探索关系与聚类", "Best for relationship exploration"),
              },
              {
                value: "hierarchical",
                label: t("层级布局", "Hierarchical"),
                description: t("按关系方向自上而下排列", "Top-down by edge direction"),
              },
              {
                value: "radial",
                label: t("环形布局", "Radial"),
                description: t("均匀展示全局结构", "Balanced overview of the graph"),
              },
              {
                value: "grid",
                label: t("网格布局", "Grid"),
                description: t("适合逐项比较顶点", "Best for scanning vertices"),
              },
            ]}
          />
        </label>
        <label className="range-field">
          <span>
            <strong>{t("顶点渲染上限")}</strong>
            <output>{settings.graphNodeLimit}</output>
          </span>
          <input
            type="range"
            min="10"
            max="500"
            step="10"
            value={settings.graphNodeLimit}
            onChange={(event) =>
              update("graphNodeLimit", Number(event.target.value))
            }
          />
        </label>
        {settings.graphLayout === "force" && (
          <div className="graph-layout-settings" data-layout="force">
            <div className="graph-layout-settings-header">
              <span className="graph-layout-token">F</span>
              <div>
                <strong>{t("力导向参数", "Force parameters")}</strong>
                <small>{t("控制物理聚类、关系张力和收敛速度。", "Tune clustering, link tension, and convergence.")}</small>
              </div>
            </div>
            <label className="range-field">
              <span>
                <strong>{t("节点斥力", "Node repulsion")}</strong>
                <output>{settings.graphLayoutConfiguration.force.repulsion}</output>
              </span>
              <input
                type="range"
                min="1000"
                max="20000"
                step="500"
                value={settings.graphLayoutConfiguration.force.repulsion}
                onChange={(event) =>
                  updateLayoutConfiguration("force", { repulsion: Number(event.target.value) })
                }
              />
            </label>
            <label className="range-field">
              <span>
                <strong>{t("关系长度", "Link distance")}</strong>
                <output>{settings.graphLayoutConfiguration.force.linkDistance}</output>
              </span>
              <input
                type="range"
                min="80"
                max="320"
                step="4"
                value={settings.graphLayoutConfiguration.force.linkDistance}
                onChange={(event) =>
                  updateLayoutConfiguration("force", { linkDistance: Number(event.target.value) })
                }
              />
            </label>
            <label className="range-field">
              <span>
                <strong>{t("中心引力", "Center gravity")}</strong>
                <output>{settings.graphLayoutConfiguration.force.centerStrength}</output>
              </span>
              <input
                type="range"
                min="1"
                max="20"
                step="1"
                value={settings.graphLayoutConfiguration.force.centerStrength}
                onChange={(event) =>
                  updateLayoutConfiguration("force", { centerStrength: Number(event.target.value) })
                }
              />
            </label>
            <label className="range-field">
              <span>
                <strong>{t("运动阻尼", "Motion damping")}</strong>
                <output>{settings.graphLayoutConfiguration.force.damping}%</output>
              </span>
              <input
                type="range"
                min="70"
                max="96"
                step="1"
                value={settings.graphLayoutConfiguration.force.damping}
                onChange={(event) =>
                  updateLayoutConfiguration("force", { damping: Number(event.target.value) })
                }
              />
            </label>
          </div>
        )}
        {settings.graphLayout === "hierarchical" && (
          <div className="graph-layout-settings" data-layout="hierarchical">
            <div className="graph-layout-settings-header">
              <span className="graph-layout-token">H</span>
              <div>
                <strong>{t("层级布局参数", "Hierarchy parameters")}</strong>
                <small>{t("控制关系方向、层级深度和同层节点密度。", "Control flow direction, depth, and sibling density.")}</small>
              </div>
            </div>
            <label className="field graph-layout-direction">
              <span>{t("关系方向", "Flow direction")}</span>
              <SelectControl
                ariaLabel={t("层级关系方向", "Hierarchy direction")}
                value={settings.graphLayoutConfiguration.hierarchical.direction}
                onValueChange={(value) =>
                  updateLayoutConfiguration("hierarchical", {
                    direction: value as GraphLayoutConfiguration["hierarchical"]["direction"],
                  })
                }
                options={[
                  { value: "top-down", label: t("从上到下", "Top to bottom"), description: t("适合流程与依赖链", "Best for flows and dependency chains") },
                  { value: "left-right", label: t("从左到右", "Left to right"), description: t("适合宽屏和长路径", "Best for wide screens and long paths") },
                ]}
              />
            </label>
            <label className="range-field">
              <span>
                <strong>{t("层级间距", "Level gap")}</strong>
                <output>{settings.graphLayoutConfiguration.hierarchical.levelGap}px</output>
              </span>
              <input
                type="range"
                min="90"
                max="280"
                step="5"
                value={settings.graphLayoutConfiguration.hierarchical.levelGap}
                onChange={(event) => updateLayoutConfiguration("hierarchical", { levelGap: Number(event.target.value) })}
              />
            </label>
            <label className="range-field">
              <span>
                <strong>{t("同层节点间距", "Sibling gap")}</strong>
                <output>{settings.graphLayoutConfiguration.hierarchical.nodeGap}px</output>
              </span>
              <input
                type="range"
                min="80"
                max="260"
                step="5"
                value={settings.graphLayoutConfiguration.hierarchical.nodeGap}
                onChange={(event) => updateLayoutConfiguration("hierarchical", { nodeGap: Number(event.target.value) })}
              />
            </label>
          </div>
        )}
        {settings.graphLayout === "radial" && (
          <div className="graph-layout-settings" data-layout="radial">
            <div className="graph-layout-settings-header">
              <span className="graph-layout-token">R</span>
              <div>
                <strong>{t("环形布局参数", "Radial parameters")}</strong>
                <small>{t("控制每圈容量、圈层距离和起始方向。", "Control ring capacity, spacing, and starting direction.")}</small>
              </div>
            </div>
            <label className="range-field">
              <span>
                <strong>{t("圈层间距", "Ring gap")}</strong>
                <output>{settings.graphLayoutConfiguration.radial.ringGap}px</output>
              </span>
              <input type="range" min="80" max="240" step="4" value={settings.graphLayoutConfiguration.radial.ringGap} onChange={(event) => updateLayoutConfiguration("radial", { ringGap: Number(event.target.value) })} />
            </label>
            <label className="range-field">
              <span>
                <strong>{t("每圈顶点数", "Vertices per ring")}</strong>
                <output>{settings.graphLayoutConfiguration.radial.ringCapacity}</output>
              </span>
              <input type="range" min="8" max="64" step="2" value={settings.graphLayoutConfiguration.radial.ringCapacity} onChange={(event) => updateLayoutConfiguration("radial", { ringCapacity: Number(event.target.value) })} />
            </label>
            <label className="range-field">
              <span>
                <strong>{t("起始角度", "Start angle")}</strong>
                <output>{settings.graphLayoutConfiguration.radial.startAngle}°</output>
              </span>
              <input type="range" min="-180" max="180" step="15" value={settings.graphLayoutConfiguration.radial.startAngle} onChange={(event) => updateLayoutConfiguration("radial", { startAngle: Number(event.target.value) })} />
            </label>
          </div>
        )}
        {settings.graphLayout === "grid" && (
          <div className="graph-layout-settings" data-layout="grid">
            <div className="graph-layout-settings-header">
              <span className="graph-layout-token">G</span>
              <div>
                <strong>{t("网格布局参数", "Grid parameters")}</strong>
                <small>{t("控制列数以及横向、纵向阅读节奏。", "Control columns and horizontal / vertical rhythm.")}</small>
              </div>
            </div>
            <label className="range-field">
              <span>
                <strong>{t("固定列数", "Fixed columns")}</strong>
                <output>{settings.graphLayoutConfiguration.grid.columns === 0 ? t("自动", "Auto") : settings.graphLayoutConfiguration.grid.columns}</output>
              </span>
              <input type="range" min="0" max="24" step="1" value={settings.graphLayoutConfiguration.grid.columns} onChange={(event) => updateLayoutConfiguration("grid", { columns: Number(event.target.value) })} />
            </label>
            <label className="range-field">
              <span>
                <strong>{t("列间距", "Column gap")}</strong>
                <output>{settings.graphLayoutConfiguration.grid.columnGap}px</output>
              </span>
              <input type="range" min="80" max="260" step="5" value={settings.graphLayoutConfiguration.grid.columnGap} onChange={(event) => updateLayoutConfiguration("grid", { columnGap: Number(event.target.value) })} />
            </label>
            <label className="range-field">
              <span>
                <strong>{t("行间距", "Row gap")}</strong>
                <output>{settings.graphLayoutConfiguration.grid.rowGap}px</output>
              </span>
              <input type="range" min="70" max="220" step="5" value={settings.graphLayoutConfiguration.grid.rowGap} onChange={(event) => updateLayoutConfiguration("grid", { rowGap: Number(event.target.value) })} />
            </label>
          </div>
        )}
        <label className="field graph-label-field">
          <span>{t("顶点显示字段", "Vertex caption fields")}</span>
          <input
            value={settings.graphVertexLabelFields}
            onChange={(event) =>
              update("graphVertexLabelFields", event.target.value)
            }
            placeholder="label,id"
          />
          <small>
            {t(
              "按顺序使用第一个非空字段；label 和 id 代表模型标签与元素 ID。",
              "The first non-empty field wins. label and id reference the model label and element ID.",
            )}
          </small>
        </label>
        <label className="field graph-label-field">
          <span>{t("关系显示字段", "Edge caption fields")}</span>
          <input
            value={settings.graphEdgeLabelFields}
            onChange={(event) =>
              update("graphEdgeLabelFields", event.target.value)
            }
            placeholder="label,id"
          />
          <small>
            {t(
              "支持关系属性或 label、id，字段以逗号分隔。",
              "Use edge properties or label / id, separated by commas.",
            )}
          </small>
        </label>
        <label className="range-field">
          <span>
            <strong>{t("边渲染上限")}</strong>
            <output>{settings.graphEdgeLimit}</output>
          </span>
          <input
            type="range"
            min="10"
            max="1000"
            step="10"
            value={settings.graphEdgeLimit}
            onChange={(event) =>
              update("graphEdgeLimit", Number(event.target.value))
            }
          />
        </label>
        <div className="setting-row">
          <div>
            <strong>{t("显示标签")}</strong>
            <small>
              {t(
                "显示按字段优先级生成的顶点与关系标题。",
                "Show vertex and edge captions generated from the configured field priority.",
              )}
            </small>
          </div>
          <SettingSwitch
            label={t("显示标签")}
            checked={settings.graphShowLabels}
            onChange={(value) => update("graphShowLabels", value)}
          />
        </div>
        <div className="setting-row">
          <div>
            <strong>{t("显示背景网格")}</strong>
            <small>{t("辅助拖动和手工排布。", "Helps with manual positioning.")}</small>
          </div>
          <SettingSwitch
            label={t("显示背景网格")}
            checked={settings.graphShowGrid}
            onChange={(value) => update("graphShowGrid", value)}
          />
        </div>
      </section>

      <section className="settings-group settings-behavior" hidden={activeSection !== "behavior"}>
        <header>
          <Settings2 size={21} />
          <div>
            <span className="eyebrow">BEHAVIOR</span>
            <h2>{t("查询与历史", "Query and History")}</h2>
          </div>
        </header>
        <label className="field">
          <span>{t("查询标签页排列", "Query tab layout")}</span>
          <SelectControl
            ariaLabel={t("查询标签页排列", "Query tab layout")}
            value={settings.queryTabLayout}
            onValueChange={(value) =>
              update("queryTabLayout", value as AppSettings["queryTabLayout"])
            }
            options={[
              {
                value: "scroll",
                label: t("同行滚动", "Single row with scrolling"),
                description: t("保持编辑器高度，并显示横向滚动条", "Preserves editor height with a visible scrollbar"),
              },
              {
                value: "wrap",
                label: t("自动换行", "Wrap to multiple rows"),
                description: t("标签较多时分行展示", "Shows more tabs across multiple rows"),
              },
            ]}
          />
        </label>
        <label className="field">
          <span>{t("默认结果视图")}</span>
          <SelectControl
            ariaLabel={t("默认结果视图")}
            value={settings.defaultResultMode}
            onValueChange={(value) =>
              update(
                "defaultResultMode",
                value as AppSettings["defaultResultMode"],
              )
            }
            options={[
              { value: "auto", label: t("自动选择") },
              { value: "graph", label: t("拓扑") },
              { value: "table", label: t("表格") },
              { value: "json", label: "JSON" },
            ]}
          />
        </label>
        <label className="range-field">
          <span>
            <strong>{t("历史记录上限")}</strong>
            <output>{settings.historyLimit}</output>
          </span>
          <input
            type="range"
            min="100"
            max="2000"
            step="100"
            value={settings.historyLimit}
            onChange={(event) => update("historyLimit", Number(event.target.value))}
          />
        </label>
        <div className="setting-row">
          <div>
            <strong>{t("下一步建议", "Next-step suggestions")}</strong>
            <small>{t("根据当前语句与历史记录显示可继续执行的 Gremlin 建议。", "Show compatible Gremlin continuations based on the query and execution history.")}</small>
          </div>
          <SettingSwitch
            label={t("下一步建议", "Next-step suggestions")}
            checked={settings.querySuggestionsEnabled}
            onChange={(value) => update("querySuggestionsEnabled", value)}
          />
        </div>
        <div className="setting-row">
          <div>
            <strong>{t("减少动态效果")}</strong>
            <small>{t("关闭非必要过渡和扫描动画。", "Disable non-essential transitions and scan effects.")}</small>
          </div>
          <SettingSwitch
            label={t("减少动态效果")}
            checked={settings.reduceMotion}
            onChange={(value) => update("reduceMotion", value)}
          />
        </div>
      </section>

      <section className="settings-group settings-shortcuts" hidden={activeSection !== "shortcuts"}>
        <header>
          <Keyboard size={21} />
          <div>
            <span className="eyebrow">KEYBOARD MAP</span>
            <h2>{t("快捷键", "Keyboard shortcuts")}</h2>
          </div>
        </header>
        <div className="shortcut-list">
          {SHORTCUT_OPTIONS.map(({ action, label, english }) => (
            <ShortcutRecorder
              key={action}
              label={t(label, english)}
              value={settings.keyboardShortcuts[action]}
              conflict={shortcutConflicts.has(settings.keyboardShortcuts[action])}
              onChange={(shortcut) =>
                update("keyboardShortcuts", {
                  ...settings.keyboardShortcuts,
                  [action]: shortcut,
                })
              }
            />
          ))}
        </div>
      </section>

      <section className="settings-group security-note" hidden={activeSection !== "security"}>
        <LockKeyhole size={25} />
        <div>
          <span className="eyebrow">CREDENTIAL VAULT</span>
          <h2>{t("安全存储")}</h2>
          <p>
            {!security
              ? t("正在检测凭据存储方式…", "Detecting credential storage…")
              : security.mode === "os"
                ? t(
                    "当前使用操作系统密钥设施保护连接密码。",
                    "Connection passwords are protected by the operating system credential store.",
                  )
                : t(
                    "系统密钥设施不可用，当前使用仅限本机用户访问的 AES-256-GCM 本地加密。",
                    "The OS credential store is unavailable. AES-256-GCM local encryption restricted to this user is active.",
                  )}
          </p>
          {security && (
            <span className={`security-mode ${security.mode}`}>
              {security.mode === "os"
                ? t("系统密钥设施")
                : t("本地加密回退")}
            </span>
          )}
          <small>
            {t(
              "当 macOS Keychain、Windows DPAPI 或 Linux Secret Service 不可用时，自动使用当前用户目录中的 AES-256-GCM 密钥，避免连接配置失效。",
              "When OS secure storage is unavailable, an AES-256-GCM key restricted to the current user keeps connections usable.",
            )}
          </small>
        </div>
      </section>
      </div>
      </div>
    </div>
  );
}

export default function App() {
  const [view, setView] = useState<ViewId>("query");
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
  const [deleteHistory, setDeleteHistory] = useState<QueryHistoryEntry | null>(null);
  const [clearHistory, setClearHistory] = useState(false);
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

  const updateQueryTab = useCallback(
    (id: string, update: Partial<QueryTabState>) =>
      setQueryTabs((current) =>
        current.map((tab) => (tab.id === id ? { ...tab, ...update } : tab)),
      ),
    [],
  );

  const addQueryTab = useCallback(
    (initialQuery = "") => {
      queryTabSequence.current += 1;
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
    [activeConnectionId, activeQueryTab.connectionId, settings.defaultResultMode],
  );

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
        queryTabSequence.current += 1;
        const replacement = createQueryTab(
          queryTabSequence.current,
          settings.defaultResultMode,
          closing?.connectionId || activeConnectionId,
        );
        setQueryTabs([replacement]);
        setActiveQueryTabId(replacement.id);
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

  const notify = useCallback((next: ToastState) => setToast(next), []);

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
          : { ...tab, connectionId: fallbackId },
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
    if (!toast) return;
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
      executionId = crypto.randomUUID(),
    ): Promise<QueryExecutionResult> => {
      if (!window.janusGraphDesktop) throw new Error("桌面 API 未加载");
      if (!connectionId) throw new Error("请先选择连接");
      const response = await window.janusGraphDesktop.queries.execute({
        connectionId,
        consoleId,
        executionId,
        query: nextQuery,
        bindings,
        recordHistory,
      });
      if (recordHistory) void loadHistory();
      return response;
    },
    [loadHistory],
  );

  const runQuery = useCallback(async (
    tabId = activeQueryTabId,
    queryOverride?: string,
    bindings: Record<string, unknown> = {},
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
    if (tab.readOnly && isMutationQuery(queryToExecute)) {
      notify({
        tone: "error",
        message: tx(
          "只读保护阻止了可能修改图数据或 Schema 的查询，请先关闭当前标签页的只读模式。",
          "Read-only protection blocked a query that may mutate graph data or schema. Disable read-only mode for this tab first.",
        ),
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
        connection.id,
        tab.id,
        queryToExecute,
        bindings,
        true,
        executionId,
      );
      const graph = buildGraphModel(response.items);
      const preferred = settings.defaultResultMode;
      const isConsoleReport = /\.(?:profile|explain)\s*\(|\.printSchema\s*\(/i.test(queryToExecute);
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
        queryState: { status: "success", result: response },
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

  const testStoredConnection = async (connection: ConnectionSummary) => {
    if (!window.janusGraphDesktop) return;
    try {
      const input: SaveConnectionInput = {
        ...connection,
        password: undefined,
      };
      const report: ConnectionTestReport =
        await window.janusGraphDesktop.connections.test(input);
      notify({
        tone: report.success ? "success" : "error",
        message: report.success
          ? `${connection.name} 连接正常，${report.latencyMs} ms`
          : report.message,
      });
    } catch (error) {
      notify({ tone: "error", message: errorMessage(error) });
    }
  };

  const activeNav = NAV_ITEMS.find((item) => item.id === view) ?? NAV_ITEMS[0]!;
  const contextualConnection = view === "query" ? queryConnection : activeConnection;
  const contextualConnectionId =
    view === "query" ? activeQueryTab.connectionId : activeConnectionId;

  return (
    <LocaleProvider locale={settings.locale}>
    <div className={`app-shell ${settings.sidebarCollapsed ? "sidebar-collapsed" : ""}`}>
      <header className="app-header">
        <button type="button" className="brand" onClick={() => setView("query")}>
          <span className="brand-mark">
            <Waypoints size={23} />
          </span>
          <span>
            <strong>JANUSGRAPH OBSERVATORY</strong>
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
          {NAV_ITEMS.map((item) => (
            <button
              type="button"
              key={item.id}
              className={view === item.id ? "is-active" : ""}
              aria-current={view === item.id ? "page" : undefined}
              title={tx(item.label)}
              onClick={() => setView(item.id)}
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
            activeConnection={queryConnection}
            query={activeQueryTab.query}
            setQuery={(query) => updateQueryTab(activeQueryTab.id, { query })}
            bindingsText={activeQueryTab.bindingsText}
            setBindingsText={(bindingsText) => updateQueryTab(activeQueryTab.id, { bindingsText })}
            bindingsEnabled={activeQueryTab.bindingsEnabled}
            setBindingsEnabled={(bindingsEnabled) => updateQueryTab(activeQueryTab.id, { bindingsEnabled })}
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
            setSelection={(selection) =>
              updateQueryTab(activeQueryTab.id, { selection })
            }
            execute={(nextQuery, bindings, recordHistory) =>
              executeFor(
                activeQueryTab.connectionId,
                activeQueryTab.id,
                nextQuery,
                bindings,
                recordHistory,
              )
            }
            settings={settings}
            onSettingsChange={setSettings}
            history={history}
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
          />
        )}
        {view === "history" && (
          <HistoryPage
            history={history}
            onUse={(entry) => {
              const restoredConnectionId = connections.some(
                (connection) => connection.id === entry.connectionId,
              )
                ? entry.connectionId
                : activeQueryTab.connectionId;
              if (
                activeQueryTab.connectionId &&
                restoredConnectionId !== activeQueryTab.connectionId
              ) {
                void window.janusGraphDesktop?.queries.closeConsole({
                  connectionId: activeQueryTab.connectionId,
                  consoleId: activeQueryTab.id,
                });
              }
              updateQueryTab(activeQueryTab.id, {
                connectionId: restoredConnectionId,
                query: entry.query,
                queryState: { status: "idle" },
                selection: null,
              });
              if (connections.some((connection) => connection.id === entry.connectionId)) {
                setActiveConnectionId(entry.connectionId);
                localStorage.setItem("janusgraph.activeConnection", entry.connectionId);
              }
              setView("query");
              notify({ tone: "info", message: "历史语句已载入编辑器" });
            }}
            onRemove={setDeleteHistory}
            onClear={() => setClearHistory(true)}
          />
        )}
        {view === "schema" && (
          <SchemaPage
            activeConnection={activeConnection}
            execute={(schemaQuery) =>
              executeFor(activeConnectionId, "schema-console", schemaQuery, {}, false)
            }
          />
        )}
        {view === "transfer" && (
          <TransferPage
            activeConnection={activeConnection}
            execute={(nextQuery, bindings, recordHistory) =>
              executeFor(
                activeConnectionId,
                "transfer-console",
                nextQuery,
                bindings,
                recordHistory,
              )
            }
            notify={notify}
          />
        )}
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
      {deleteHistory && (
        <ConfirmDialog
          title={tx("删除历史记录", "Delete History Record")}
          description={tx(
            "这条本地执行记录将被删除，查询语句和服务器数据不会受到影响。",
            "This removes only the local record. The server data is not affected.",
          )}
          confirmLabel={tx("删除记录", "Delete Record")}
          onCancel={() => setDeleteHistory(null)}
          onConfirm={async () => {
            await window.janusGraphDesktop?.history.remove(deleteHistory.id);
            setDeleteHistory(null);
            await loadHistory();
          }}
        />
      )}
      {clearHistory && (
        <ConfirmDialog
          title={tx("清空执行历史", "Clear Execution History")}
          description={tx(
            `将删除本机保存的 ${history.length} 条执行记录。此操作不会删除连接或服务器数据。`,
            `This removes ${history.length} local records. Connections and server data are not affected.`,
          )}
          confirmLabel={tx("清空历史")}
          onCancel={() => setClearHistory(false)}
          onConfirm={async () => {
            await window.janusGraphDesktop?.history.clear();
            setClearHistory(false);
            await loadHistory();
          }}
        />
      )}
      {toast && (
        <div className={`toast ${toast.tone}`} role="status" aria-live="polite">
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
