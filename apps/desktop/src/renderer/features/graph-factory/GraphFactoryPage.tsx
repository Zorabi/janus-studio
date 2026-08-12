import type { ConnectionSummary, QueryExecutionResult } from "@janusgraph/domain";
import {
  AlertTriangle,
  Boxes,
  Braces,
  ChevronRight,
  CircleOff,
  Copy,
  Database,
  Download,
  Eye,
  EyeOff,
  FileJson,
  KeyRound,
  Layers3,
  LoaderCircle,
  Lock,
  LockKeyhole,
  Network,
  Pencil,
  Play,
  Plus,
  RadioTower,
  RefreshCw,
  Save,
  Search,
  ServerCog,
  ShieldCheck,
  Trash2,
  Upload,
} from "lucide-react";
import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { SelectControl } from "../../components/SelectControl";
import { ConfirmDialog, EmptyState, Modal, PageHeader } from "../../components/ui";
import {
  configurationToRows,
  duplicateGraphInstanceId,
  GRAPH_FACTORY_PROBE_QUERY,
  GRAPH_FACTORY_QUERIES,
  isProtectedConfigurationKey,
  isSensitiveConfigurationKey,
  parseConfigurationJson,
  parseGraphFactoryState,
  parseGraphInstanceSnapshot,
  rowsToConfiguration,
  validateGraphName,
  type ConfigurationRow,
  type ConfiguredGraphFactoryState,
  type ConfiguredGraphSummary,
  type GraphFactoryConfiguration,
  type GraphInstanceSession,
} from "../../lib/configured-graph-factory";
import { useTranslate } from "../../lib/i18n";
import { errorMessage } from "../../lib/presentation";
import type { ToastState } from "../query/query-workspace";

type FactoryLoadState =
  | { status: "idle" | "loading" }
  | { status: "error"; message: string }
  | { status: "success"; value: ConfiguredGraphFactoryState };

type ConfigurationEditorState = {
  scope: "graph" | "template";
  operation: "create" | "update";
  graphName: string;
  rows: ConfigurationRow[];
  initialKeys: string[];
};

type PendingConfirmation = {
  title: string;
  description: string;
  label: string;
  run: () => Promise<void>;
};

type InstanceLoadState =
  | { status: "idle" | "loading" }
  | { status: "pending"; graphName: string; attempt: number }
  | { status: "error"; graphName: string; message: string }
  | { status: "success"; graphName: string; sessions: GraphInstanceSession[] };

function configurationEntries(configuration: GraphFactoryConfiguration) {
  return Object.entries(configuration).sort(([left], [right]) =>
    left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" }),
  );
}

function displayValue(key: string, value: unknown, revealSensitive: boolean) {
  if (isSensitiveConfigurationKey(key) && !revealSensitive) return "••••••••";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

function ConfigurationPreview({
  configuration,
  revealSensitive,
}: {
  configuration: GraphFactoryConfiguration;
  revealSensitive: boolean;
}) {
  const t = useTranslate();
  const entries = configurationEntries(configuration);
  if (entries.length === 0) {
    return <p className="factory-config-empty">{t("没有可显示的配置项", "No configuration entries")}</p>;
  }
  return (
    <div className="factory-config-list">
      {entries.map(([key, value]) => (
        <div className="factory-config-row" key={key}>
          <code>{key}</code>
          <span title={displayValue(key, value, revealSensitive)}>
            {displayValue(key, value, revealSensitive)}
          </span>
        </div>
      ))}
    </div>
  );
}

function ConfigurationEditor({
  editor,
  busy,
  onChange,
  onClose,
  onSave,
}: {
  editor: ConfigurationEditorState;
  busy: boolean;
  onChange: (editor: ConfigurationEditorState) => void;
  onClose: () => void;
  onSave: (configuration: GraphFactoryConfiguration, graphName: string) => void;
}) {
  const t = useTranslate();
  const [revealSensitive, setRevealSensitive] = useState(false);
  const [message, setMessage] = useState("");
  const [search, setSearch] = useState("");

  const groupedRows = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    const groups = new Map<string, ConfigurationRow[]>();
    for (const row of editor.rows) {
      if (normalizedSearch && !`${row.key} ${row.value}`.toLowerCase().includes(normalizedSearch)) {
        continue;
      }
      const prefix = row.key.split(/[._-]/)[0]?.toLowerCase() || "other";
      const group = ["graph", "storage", "index", "schema", "cache", "ids"].includes(prefix)
        ? prefix
        : "other";
      groups.set(group, [...(groups.get(group) ?? []), row]);
    }
    const order = ["graph", "storage", "index", "schema", "cache", "ids", "other"];
    return order.flatMap((group) => {
      const rows = groups.get(group);
      return rows?.length ? [{ group, rows }] : [];
    });
  }, [editor.rows, search]);

  const groupLabel = (group: string) => ({
    graph: t("图与实例", "Graph and instance"),
    storage: t("存储后端", "Storage backend"),
    index: t("索引后端", "Index backend"),
    schema: "Schema",
    cache: t("缓存", "Cache"),
    ids: t("标识分配", "Identifier allocation"),
    other: t("其他配置", "Other configuration"),
  })[group] ?? group;

  const updateRow = (id: string, update: Partial<ConfigurationRow>) => {
    onChange({
      ...editor,
      rows: editor.rows.map((row) => row.id === id ? { ...row, ...update } : row),
    });
  };

  const importJson = async () => {
    const file = await window.janusGraphDesktop?.files.pickDataFile();
    if (!file) return;
    try {
      const configuration = parseConfigurationJson(file.content);
      const protectedRows = editor.rows.filter((row) => isProtectedConfigurationKey(row.key));
      const importedRows = configurationToRows(configuration).filter(
        (row) => !isProtectedConfigurationKey(row.key),
      );
      onChange({ ...editor, rows: [...protectedRows, ...importedRows] });
      setMessage("");
    } catch (error) {
      setMessage(errorMessage(error));
    }
  };

  const exportJson = async () => {
    try {
      const configuration = rowsToConfiguration(editor.rows);
      await window.janusGraphDesktop?.files.saveDataFile({
        suggestedName: editor.scope === "template"
          ? "configured-graph-template.json"
          : `${editor.graphName || "graph"}-configuration.json`,
        format: "json",
        content: JSON.stringify(configuration, null, 2),
      });
      setMessage("");
    } catch (error) {
      setMessage(errorMessage(error));
    }
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    try {
      onSave(
        rowsToConfiguration(editor.rows),
        editor.scope === "graph" ? validateGraphName(editor.graphName) : "",
      );
      setMessage("");
    } catch (error) {
      setMessage(errorMessage(error));
    }
  };

  return (
    <Modal
      title={editor.scope === "template"
        ? t("模板配置", "Template Configuration")
        : editor.operation === "update"
          ? t(`更新“${editor.graphName}”的配置`, `Update configuration for “${editor.graphName}”`)
          : t("登记独立图配置", "Register Standalone Graph Configuration")}
      eyebrow={editor.scope === "graph" && editor.operation === "create" ? "ADVANCED REGISTRATION" : "CONFIGURATION EDITOR"}
      onClose={onClose}
    >
      <form className="factory-config-editor" onSubmit={submit}>
        <div className="factory-editor-toolbar">
          <div className="factory-editor-identity">
            <span className="factory-editor-symbol"><Braces size={20} /></span>
            {editor.scope === "graph" ? (
              editor.operation === "update" ? (
                <div><small>{t("当前图", "Current graph")}</small><strong>{editor.graphName}</strong></div>
              ) : (
                <label className="field factory-name-field">
                  <span>{t("图名称", "Graph name")}</span>
                  <input
                    value={editor.graphName}
                    maxLength={120}
                    onChange={(event) => onChange({ ...editor, graphName: event.target.value })}
                    placeholder="analytics"
                    required
                  />
                </label>
              )
            ) : (
              <div><small>{t("配置范围", "Configuration scope")}</small><strong>Template Configuration</strong></div>
            )}
          </div>
          <div className="factory-editor-actions">
            <button type="button" className="button text" onClick={() => void importJson()}>
              <Upload size={16} />
              {t("导入 JSON", "Import JSON")}
            </button>
            <button type="button" className="button text" onClick={() => void exportJson()}>
              <Download size={16} />
              {t("导出 JSON", "Export JSON")}
            </button>
            <button
              type="button"
              className="button text"
              onClick={() => setRevealSensitive((current) => !current)}
            >
              {revealSensitive ? <EyeOff size={16} /> : <Eye size={16} />}
              {revealSensitive
                ? t("隐藏敏感值", "Hide sensitive values")
                : t("显示敏感值", "Reveal sensitive values")}
            </button>
          </div>
        </div>
        {editor.scope === "graph" && editor.operation === "create" && (
          <div className="factory-registration-note">
            <ServerCog size={18} />
            <div>
              <strong>{t("用于登记已有独立后端", "Register an existing standalone backend")}</strong>
              <small>{t(
                "这不是普通建图入口。保存后会登记 Configuration、立即打开目标图并回读验证；常规新图请使用 Template Configuration 创建。",
                "This is not the standard graph creation flow. Saving registers the Configuration, opens the target graph immediately, and verifies it. Use the Template Configuration flow for regular new graphs.",
              )}</small>
            </div>
          </div>
        )}
        <div className="factory-editor-heading">
          <div>
            <strong>{t("结构化键值", "Structured key-value configuration")}</strong>
            <small>{t(
              "按命名空间自动分组；为每项选择值类型，字符串无需额外引号。",
              "Entries are grouped by namespace. Choose a value type for each entry; strings need no extra quotes.",
            )}</small>
          </div>
          <div className="factory-editor-heading-actions">
            <label className="factory-editor-search">
              <Search size={15} />
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t("筛选 Key 或 Value", "Filter keys or values")} />
            </label>
            <button
              type="button"
              className="button secondary"
              onClick={() => {
                const row = { id: crypto.randomUUID(), key: "", value: "", valueType: "string" as const };
                onChange({ ...editor, rows: [...editor.rows, row] });
                setSearch("");
              }}
            >
              <Plus size={16} />
              {t("添加配置项", "Add entry")}
            </button>
          </div>
        </div>
        <div className="factory-editor-rows">
          {editor.rows.length === 0 ? (
            <div className="factory-editor-empty">
              <Braces size={22} />
              <span>{t("添加第一项，或从 JSON 文件导入", "Add the first entry or import a JSON file")}</span>
            </div>
          ) : groupedRows.length === 0 ? (
            <div className="factory-editor-empty"><Search size={22} /><span>{t("没有匹配的配置项", "No matching configuration entries")}</span></div>
          ) : groupedRows.map(({ group, rows }) => (
            <section className="factory-editor-group" key={group}>
              <header><span>{groupLabel(group)}</span><small>{rows.length}</small></header>
              <div className="factory-editor-group-rows">
                {rows.map((row) => {
                  const sensitive = isSensitiveConfigurationKey(row.key);
                  const protectedRow = isProtectedConfigurationKey(row.key);
                  return (
                    <div className={`factory-editor-row ${protectedRow ? "is-protected" : ""}`} key={row.id}>
                      <span className="factory-row-marker" aria-hidden="true" />
                      <label className="factory-editor-cell factory-key-cell">
                        <small>{t("配置键", "Configuration key")}</small>
                        <input
                          value={row.key}
                          disabled={protectedRow}
                          placeholder="storage.backend"
                          spellCheck={false}
                          onChange={(event) => updateRow(row.id, { key: event.target.value })}
                        />
                      </label>
                      <label className="factory-editor-cell factory-value-cell">
                        <small>{t("配置值", "Configuration value")}</small>
                        <input
                          type={sensitive && !revealSensitive ? "password" : "text"}
                          value={row.value}
                          disabled={protectedRow}
                          placeholder={row.valueType === "string" ? "cql" : row.valueType === "boolean" ? "true" : "{}"}
                          spellCheck={false}
                          onChange={(event) => updateRow(row.id, { value: event.target.value })}
                        />
                      </label>
                      <div className="factory-editor-type">
                        <small>{t("类型", "Type")}</small>
                        <SelectControl
                          ariaLabel={t("配置值类型", "Configuration value type")}
                          className="factory-type-select"
                          value={row.valueType}
                          disabled={protectedRow}
                          onValueChange={(value) => updateRow(row.id, { valueType: value as ConfigurationRow["valueType"] })}
                          options={[
                            { value: "string", label: "STRING" },
                            { value: "number", label: "NUMBER" },
                            { value: "boolean", label: "BOOLEAN" },
                            { value: "json", label: "JSON" },
                          ]}
                        />
                      </div>
                      {protectedRow ? (
                        <span className="factory-row-lock" title={t("系统管理项不可直接修改", "System-managed entry cannot be edited directly")}><Lock size={15} /></span>
                      ) : (
                        <button
                          type="button"
                          className="icon-button factory-row-remove"
                          aria-label={t("移除配置项", "Remove configuration entry")}
                          onClick={() => onChange({ ...editor, rows: editor.rows.filter((candidate) => candidate.id !== row.id) })}
                        >
                          <Trash2 size={15} />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
        {message && <div className="inline-message error"><AlertTriangle size={17} /><span>{message}</span></div>}
        <footer className="modal-actions">
          <button type="button" className="button secondary" onClick={onClose}>
            {t("取消", "Cancel")}
          </button>
          <button type="submit" className="button primary" disabled={busy}>
            {busy ? <LoaderCircle className="spin" size={17} /> : <Save size={17} />}
            {editor.operation === "create"
              ? editor.scope === "graph"
                ? t("登记并打开", "Register and open")
                : t("创建配置", "Create configuration")
              : editor.scope === "graph"
                ? t("更新此图配置", "Update this graph")
                : t("保存更改", "Save changes")}
          </button>
        </footer>
      </form>
    </Modal>
  );
}

export function GraphFactoryPage({
  activeConnection,
  execute,
  onUseGraph,
  onManageSchema,
  notify,
}: {
  activeConnection: ConnectionSummary | undefined;
  execute: (
    query: string,
    bindings?: Record<string, unknown>,
    productionConfirmed?: boolean,
  ) => Promise<QueryExecutionResult>;
  onUseGraph: (graph: ConfiguredGraphSummary) => void;
  onManageSchema: (graph: ConfiguredGraphSummary) => void;
  notify: (toast: ToastState) => void;
}) {
  const t = useTranslate();
  const [state, setState] = useState<FactoryLoadState>({ status: "idle" });
  const [busy, setBusy] = useState("");
  const [selectedGraph, setSelectedGraph] = useState("");
  const [revealSensitive, setRevealSensitive] = useState(false);
  const [editor, setEditor] = useState<ConfigurationEditorState | null>(null);
  const [createGraphName, setCreateGraphName] = useState<string | null>(null);
  const [dropGraph, setDropGraph] = useState<ConfiguredGraphSummary | null>(null);
  const [dropPhrase, setDropPhrase] = useState("");
  const [clearOtherInstances, setClearOtherInstances] = useState<{
    graph: ConfiguredGraphSummary;
    count: number;
  } | null>(null);
  const [clearInstancesPhrase, setClearInstancesPhrase] = useState("");
  const [confirmation, setConfirmation] = useState<PendingConfirmation | null>(null);
  const [instances, setInstances] = useState<InstanceLoadState>({ status: "idle" });

  const refresh = useCallback(async () => {
    if (!activeConnection) {
      setState({ status: "idle" });
      return;
    }
    setState({ status: "loading" });
    try {
      const response = await execute(GRAPH_FACTORY_PROBE_QUERY, {}, false);
      const value = parseGraphFactoryState(response.items);
      if (!value) throw new Error(t(
        "服务端返回了无法识别的 ConfiguredGraphFactory 响应。",
        "The server returned an unrecognized ConfiguredGraphFactory response.",
      ));
      setState({ status: "success", value });
      setSelectedGraph((current) => value.graphs.some((graph) => graph.name === current)
        ? current
        : value.graphs[0]?.name ?? "");
    } catch (error) {
      setState({ status: "error", message: errorMessage(error) });
    }
  }, [activeConnection?.id]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const factory = state.status === "success" ? state.value : null;
  const selected = factory?.graphs.find((graph) => graph.name === selectedGraph);
  const readOnly = activeConnection?.connectionReadOnly === true;
  const production = activeConnection?.environment === "prod";

  const perform = async (
    key: string,
    query: string,
    bindings: Record<string, unknown>,
    successMessage: string,
    productionConfirmed = false,
    after?: () => void,
  ) => {
    setBusy(key);
    try {
      await execute(query, bindings, productionConfirmed);
      after?.();
      notify({ tone: "success", message: successMessage, dismissOnly: true });
      await refresh();
    } catch (error) {
      notify({ tone: "error", message: errorMessage(error), dismissOnly: true });
    } finally {
      setBusy("");
    }
  };

  const requestMutation = (
    operation: PendingConfirmation,
    alwaysConfirm = false,
  ) => {
    if (readOnly) {
      notify({
        tone: "error",
        message: t(
          "当前连接启用了连接级只读保护，Graph Factory 变更已被阻止。",
          "Connection-level read-only protection blocked this Graph Factory change.",
        ),
      });
      return;
    }
    if (production || alwaysConfirm) setConfirmation(operation);
    else void operation.run();
  };

  const saveConfiguration = (
    configuration: GraphFactoryConfiguration,
    graphName: string,
  ) => {
    if (!editor) return;
    const isTemplate = editor.scope === "template";
    const removedKeys = editor.initialKeys.filter(
      (key) => !isProtectedConfigurationKey(key) && !Object.hasOwn(configuration, key),
    );
    const query = isTemplate
      ? editor.operation === "create"
        ? GRAPH_FACTORY_QUERIES.createTemplateConfiguration
        : removedKeys.length > 0
          ? GRAPH_FACTORY_QUERIES.replaceTemplateConfiguration
          : GRAPH_FACTORY_QUERIES.updateTemplateConfiguration
      : editor.operation === "create"
        ? GRAPH_FACTORY_QUERIES.createConfiguration
        : GRAPH_FACTORY_QUERIES.updateConfiguration;
    const label = isTemplate ? t("模板配置", "template configuration") : `“${graphName}”`;
    const registeringStandalone = !isTemplate && editor.operation === "create";
    requestMutation({
      title: registeringStandalone
        ? t("确认登记独立图配置", "Confirm Standalone Graph Registration")
        : t("确认修改 Graph Factory", "Confirm Graph Factory Change"),
      description: registeringStandalone
        ? t(
            `将登记 ${label} 的独立 Configuration，随后立即打开图并回读验证。请确认后端配置指向正确的数据。`,
            `Register a standalone Configuration for ${label}, then open the graph immediately and verify it. Confirm that the backend settings point to the intended data.`,
          )
        : t(
            `将修改 ${label}。模板更新不会自动更新此前创建的图。`,
            `This changes ${label}. Template updates do not update graphs created earlier.`,
          ),
      label: registeringStandalone
        ? t("登记并打开", "Register and open")
        : editor.operation === "create" ? t("创建", "Create") : t("保存更改", "Save changes"),
      run: async () => {
        setConfirmation(null);
        await perform(
          `configuration:${graphName || "template"}`,
          query,
          isTemplate
            ? { configuration }
            : { graphName, configuration, removedKeys },
          registeringStandalone
            ? t("独立图配置已登记、打开并验证", "Standalone graph configuration registered, opened, and verified")
            : t("Configuration 已保存", "Configuration saved"),
          production,
          () => {
            setEditor(null);
            if (registeringStandalone) setSelectedGraph(graphName);
          },
        );
      },
    });
  };

  const createGraph = () => {
    try {
      const graphName = validateGraphName(createGraphName ?? "");
      requestMutation({
        title: t("确认创建动态图", "Confirm Dynamic Graph Creation"),
        description: t(
          `将使用当前 Template Configuration 创建“${graphName}”。集群 Binding 传播可能需要约 20 秒。`,
          `Create “${graphName}” from the current Template Configuration. Cluster binding propagation can take about 20 seconds.`,
        ),
        label: t("创建图", "Create graph"),
        run: async () => {
          setConfirmation(null);
          await perform(
            `create:${graphName}`,
            GRAPH_FACTORY_QUERIES.createGraph,
            { graphName },
            t(`动态图“${graphName}”已创建`, `Dynamic graph “${graphName}” created`),
            production,
            () => setCreateGraphName(null),
          );
        },
      });
    } catch (error) {
      notify({ tone: "error", message: errorMessage(error) });
    }
  };

  const simpleGraphAction = (
    graph: ConfiguredGraphSummary,
    action: "load" | "reload" | "close",
  ) => {
    const definitions = {
      load: {
        query: GRAPH_FACTORY_QUERIES.openGraph,
        title: t("立即加载图引用", "Load Graph Reference Now"),
        description: t(
          `立即在当前服务实例中打开“${graph.name}”，并注册 Graph Binding 与 Traversal Source。已打开时将复用现有引用，不会修改图配置或后端数据。`,
          `Open “${graph.name}” immediately on the current server instance and register its Graph Binding and Traversal Source. An existing open reference is reused; configuration and backend data are not changed.`,
        ),
        label: t("立即加载", "Load now"),
        success: t(`“${graph.name}”图引用已加载`, `Graph reference for “${graph.name}” loaded`),
      },
      reload: {
        query: GRAPH_FACTORY_QUERIES.reloadGraph,
        title: t("重新加载图引用", "Reload Graph Reference"),
        description: t(
          `先关闭“${graph.name}”在当前服务实例中的缓存引用，再立即重新打开并注册 Graph Binding 与 Traversal Source。不会修改图配置或后端数据。`,
          `Close the cached reference for “${graph.name}” on the current server instance, then immediately reopen it and register its Graph Binding and Traversal Source. Configuration and backend data are not changed.`,
        ),
        label: t("确认重新加载", "Reload reference"),
        success: t(`“${graph.name}”图引用已重新加载`, `Graph reference for “${graph.name}” reloaded`),
      },
      close: {
        query: GRAPH_FACTORY_QUERIES.closeGraph,
        title: t("关闭图", "Close Graph"),
        description: t(
          `调用 ConfiguredGraphFactory.close('${graph.name}')，关闭当前服务实例中的图并移除缓存引用。不会删除配置或后端数据；只要 Configuration 仍存在，JanusGraphManager 最长约 20 秒后可能自动重新加载该图。`,
          `Call ConfiguredGraphFactory.close('${graph.name}') to close the graph and remove its cached reference from the current server instance. Configuration and backend data remain; while the Configuration exists, JanusGraphManager may automatically load the graph again within about 20 seconds.`,
        ),
        label: t("确认关闭图", "Close graph"),
        success: t(`“${graph.name}”关闭请求已执行`, `Close request executed for “${graph.name}”`),
      },
    }[action];
    const operation = {
      title: definitions.title,
      description: definitions.description,
      label: definitions.label,
      run: async () => {
        setConfirmation(null);
        await perform(
          `${action}:${graph.name}`,
          definitions.query,
          { graphName: graph.name },
          definitions.success,
          production,
          () => setInstances({ status: "pending", graphName: graph.name, attempt: 0 }),
        );
      },
    };
    requestMutation(operation, action !== "load");
  };

  const useGraphInQuery = async (graph: ConfiguredGraphSummary) => {
    setBusy(`context:${graph.name}`);
    try {
      await execute(GRAPH_FACTORY_QUERIES.openGraph, { graphName: graph.name }, false);
      onUseGraph(graph);
    } catch (error) {
      notify({ tone: "error", message: errorMessage(error), dismissOnly: true });
    } finally {
      setBusy("");
    }
  };

  const manageGraphSchema = async (graph: ConfiguredGraphSummary) => {
    setBusy(`schema:${graph.name}`);
    try {
      await execute(GRAPH_FACTORY_QUERIES.openGraph, { graphName: graph.name }, false);
      onManageSchema(graph);
    } catch (error) {
      notify({ tone: "error", message: errorMessage(error), dismissOnly: true });
    } finally {
      setBusy("");
    }
  };

  const loadInstances = useCallback(async (graphName: string, attempt = 0) => {
    setInstances({ status: "loading" });
    try {
      const response = await execute(
        GRAPH_FACTORY_QUERIES.listInstances,
        { graphName },
        false,
      );
      const snapshot = parseGraphInstanceSnapshot(response.items);
      if (!snapshot) throw new Error("Invalid JanusGraph instance snapshot");
      setInstances(snapshot.available
        ? { status: "success", graphName, sessions: snapshot.sessions }
        : { status: "pending", graphName, attempt });
    } catch (error) {
      setInstances({ status: "error", graphName, message: errorMessage(error) });
    }
  }, [activeConnection?.id]);

  useEffect(() => {
    if (!selected?.name) {
      setInstances({ status: "idle" });
      return;
    }
    void loadInstances(selected.name);
  }, [activeConnection?.id, selected?.name, loadInstances]);

  useEffect(() => {
    if (instances.status !== "pending" || instances.attempt >= 8) return;
    const timeout = window.setTimeout(() => {
      void loadInstances(instances.graphName, instances.attempt + 1);
    }, 3_000);
    return () => window.clearTimeout(timeout);
  }, [instances, loadInstances]);

  const forceCloseInstance = (
    graph: ConfiguredGraphSummary,
    session: GraphInstanceSession,
  ) => {
    requestMutation({
      title: t("强制移除 JanusGraph 实例", "Force-remove JanusGraph Instance"),
      description: t(
        `仅当实例“${session.id}”已经异常退出时才能继续。移除仍在运行的实例可能造成数据不一致。`,
        `Continue only if instance “${session.id}” has terminated abnormally. Removing a running instance can cause data inconsistency.`,
      ),
      label: t("确认实例已停止并移除", "Instance is stopped — remove it"),
      run: async () => {
        setConfirmation(null);
        setBusy(`instance:${session.id}`);
        try {
          await execute(
            GRAPH_FACTORY_QUERIES.forceCloseInstance,
            { graphName: graph.name, instanceId: session.id },
            production,
          );
          notify({
            tone: "success",
            message: t(
              `实例“${session.id}”的注册记录已移除`,
              `Registration for instance “${session.id}” was removed`,
            ),
            dismissOnly: true,
          });
          await loadInstances(graph.name);
        } catch (error) {
          notify({ tone: "error", message: errorMessage(error), dismissOnly: true });
        } finally {
          setBusy("");
        }
      },
    }, true);
  };

  const forceCloseOtherInstances = (
    graph: ConfiguredGraphSummary,
    sessions: GraphInstanceSession[],
  ) => {
    const others = sessions.filter((session) => !session.current);
    if (others.length === 0) return;
    setClearInstancesPhrase("");
    setClearOtherInstances({ graph, count: others.length });
  };

  const confirmForceCloseOtherInstances = async () => {
    if (!clearOtherInstances || clearInstancesPhrase !== clearOtherInstances.graph.name) return;
    const { graph, count } = clearOtherInstances;
    setBusy(`instances:all:${graph.name}`);
    try {
      await execute(
        GRAPH_FACTORY_QUERIES.forceCloseOtherInstances,
        { graphName: graph.name },
        production,
      );
      setClearOtherInstances(null);
      setClearInstancesPhrase("");
      notify({
        tone: "success",
        message: t(
          `已清除“${graph.name}”的 ${count} 个其他实例注册`,
          `Cleared ${count} other instance registrations from “${graph.name}”`,
        ),
        dismissOnly: true,
      });
      await loadInstances(graph.name);
    } catch (error) {
      notify({ tone: "error", message: errorMessage(error), dismissOnly: true });
    } finally {
      setBusy("");
    }
  };

  const publishDropTask = async (
    id: string,
    graph: ConfiguredGraphSummary,
    status: "running" | "succeeded" | "failed",
    message: string,
  ) => {
    if (!activeConnection || !window.janusGraphDesktop) {
      throw new Error(t("桌面任务服务不可用", "Desktop task service is unavailable"));
    }
    await window.janusGraphDesktop.tasks.publish({
      id,
      kind: "maintenance",
      action: "drop",
      title: graph.name,
      connectionId: activeConnection.id,
      graphName: graph.name,
      status,
      stage: status === "running" ? "dropping" : "completed",
      message,
      progressCurrent: status === "succeeded" ? 1 : 0,
      progressTotal: 1,
      progressUnit: "graph",
      cancellable: false,
      retriable: false,
    });
    window.dispatchEvent(new CustomEvent("janus-studio:background-task", {
      detail: { open: status === "running" },
    }));
  };

  const performDrop = async (graph: ConfiguredGraphSummary) => {
    const taskId = crypto.randomUUID();
    setBusy(`drop:${graph.name}`);
    try {
      await publishDropTask(
        taskId,
        graph,
        "running",
        t(`正在永久删除“${graph.name}”`, `Permanently dropping “${graph.name}”`),
      );
      setDropGraph(null);
      setDropPhrase("");
      await execute(GRAPH_FACTORY_QUERIES.dropGraph, { graphName: graph.name }, production);
      await publishDropTask(
        taskId,
        graph,
        "succeeded",
        t(`“${graph.name}”及其数据已永久删除`, `“${graph.name}” and its data were permanently deleted`),
      );
      setInstances({ status: "idle" });
      notify({
        tone: "success",
        message: t(`“${graph.name}”及其数据已永久删除`, `“${graph.name}” and its data were permanently deleted`),
        dismissOnly: true,
      });
      await refresh();
    } catch (error) {
      const message = errorMessage(error);
      try {
        await publishDropTask(taskId, graph, "failed", message);
      } catch {
        // The original failure remains the user-facing error when persistence is unavailable.
      }
      notify({ tone: "error", message, dismissOnly: true });
    } finally {
      setBusy("");
    }
  };

  const selectedInstanceSessions =
    instances.status === "success" && instances.graphName === selected?.name
      ? instances.sessions
      : [];
  const otherInstanceCount = selectedInstanceSessions.filter((session) => !session.current).length;
  const currentInstanceCount = selectedInstanceSessions.filter((session) => session.current).length;
  const dropInstanceSessions =
    dropGraph && instances.status === "success" && instances.graphName === dropGraph.name
      ? instances.sessions
      : [];
  const dropOtherInstanceCount = dropInstanceSessions.filter((session) => !session.current).length;
  const dropCurrentInstanceCount = dropInstanceSessions.filter((session) => session.current).length;
  const dropPreflightReady = Boolean(
    dropGraph &&
    instances.status === "success" &&
    instances.graphName === dropGraph.name &&
    dropCurrentInstanceCount > 0 &&
    dropOtherInstanceCount === 0,
  );
  const instanceConflictId = instances.status === "error"
    ? duplicateGraphInstanceId(instances.message)
    : null;

  if (!activeConnection) {
    return (
      <div className="page-scroll">
        <PageHeader
          eyebrow="CONFIGURED GRAPH FACTORY"
          title={t("动态图管理", "Dynamic Graphs")}
          description={t(
            "管理 ConfiguredGraphFactory 图、单图配置和 Template Configuration。",
            "Manage ConfiguredGraphFactory graphs, per-graph configurations and the Template Configuration.",
          )}
        />
        <EmptyState
          icon={<Network size={30} />}
          title={t("请先选择连接", "Select a connection")}
          description={t(
            "Graph Factory 能力会在选择 JanusGraph Server 后进行探测。",
            "Graph Factory capability is detected after selecting a JanusGraph Server.",
          )}
        />
      </div>
    );
  }

  return (
    <div className="page-scroll graph-factory-page">
      <PageHeader
        eyebrow="CONFIGURED GRAPH FACTORY"
        title={t("动态图管理", "Dynamic Graphs")}
        description={t(
          "独立管理动态图生命周期、模板与图配置；查询标签页通过 Traversal Source override 使用目标图。",
          "Manage dynamic graph lifecycle, templates and graph configurations; query tabs use the target graph through a Traversal Source override.",
        )}
        actions={
          <button type="button" className="button secondary" onClick={() => void refresh()} disabled={state.status === "loading"}>
            {state.status === "loading" ? <LoaderCircle className="spin" size={17} /> : <RefreshCw size={17} />}
            {t("重新探测", "Probe again")}
          </button>
        }
      />

      <div className="factory-connection-banner">
        <ServerCog size={20} />
        <div>
          <strong>{activeConnection.name}</strong>
          <small>{activeConnection.protocol.toUpperCase()} · {activeConnection.clientMode.toUpperCase()}</small>
        </div>
        <span className={`badge environment ${activeConnection.environment}`}>
          {activeConnection.environment.toUpperCase()}
        </span>
        {readOnly && <span className="badge read-only"><LockKeyhole size={14} />{t("只读", "Read only")}</span>}
      </div>

      {state.status === "loading" && (
        <div className="factory-loading"><LoaderCircle className="spin" size={24} /><span>{t("正在探测服务端能力", "Detecting server capability")}</span></div>
      )}
      {state.status === "error" && (
        <section className="factory-setup-state">
          <div className="factory-setup-icon"><CircleOff size={27} /></div>
          <div>
            <span className="eyebrow">CAPABILITY UNAVAILABLE</span>
            <h2>{t("ConfiguredGraphFactory 尚不可用", "ConfiguredGraphFactory is unavailable")}</h2>
            <p>{state.message}</p>
            <ul>
              <li>{t("在 Gremlin Server 启用 ConfigurationManagementGraph。", "Enable ConfigurationManagementGraph in Gremlin Server.")}</li>
              <li>{t("在集群每个节点配置 JanusGraphManager。", "Configure JanusGraphManager on every cluster node.")}</li>
              <li>{t("确认当前账号可以执行 Gremlin Groovy 管理脚本。", "Ensure the current account can execute Gremlin Groovy management scripts.")}</li>
            </ul>
          </div>
        </section>
      )}

      {factory && (
        <>
          <section className="factory-overview">
            <article><Boxes size={20} /><div><strong>{factory.graphs.length}</strong><small>{t("动态图", "Dynamic graphs")}</small></div></article>
            <article><FileJson size={20} /><div><strong>{factory.templateConfiguration ? t("已配置", "Ready") : t("未配置", "Missing")}</strong><small>Template Configuration</small></div></article>
            <article><Network size={20} /><div><strong>{factory.graphs.filter((graph) => graph.traversalSource).length}</strong><small>Traversal Bindings</small></div></article>
          </section>

          {readOnly && (
            <div className="factory-readonly-notice">
              <LockKeyhole size={18} />
              <span>{t(
                "当前连接启用了连接级只读保护：可以探测、查看配置并创建查询上下文，所有配置和生命周期变更均已禁用。",
                "Connection-level read-only protection is enabled: probing, inspection and query contexts remain available; configuration and lifecycle changes are disabled.",
              )}</span>
            </div>
          )}

          <section className="factory-template-panel">
            <header>
              <div>
                <span className="eyebrow">TEMPLATE CONFIGURATION</span>
                <h2>{t("动态图模板", "Dynamic Graph Template")}</h2>
                <p>{t(
                  "模板仅用于之后创建的图；修改模板不会回写现有图。",
                  "The template applies only to graphs created later; changes do not update existing graphs.",
                )}</p>
              </div>
              <div className="factory-section-actions">
                {factory.templateConfiguration && (
                  <button type="button" className="button primary" disabled={readOnly} onClick={() => setCreateGraphName("")}>
                    <Plus size={16} />{t("从模板创建图", "Create from template")}
                  </button>
                )}
                <button
                  type="button"
                  className="button secondary"
                  disabled={readOnly}
                  onClick={() => setEditor({
                    scope: "template",
                    operation: factory.templateConfiguration ? "update" : "create",
                    graphName: "",
                    rows: configurationToRows(factory.templateConfiguration ?? {}),
                    initialKeys: Object.keys(factory.templateConfiguration ?? {}),
                  })}
                >
                  {factory.templateConfiguration ? <Pencil size={16} /> : <Plus size={16} />}
                  {factory.templateConfiguration ? t("编辑模板", "Edit template") : t("创建模板", "Create template")}
                </button>
                {factory.templateConfiguration && (
                  <button
                    type="button"
                    className="button text danger-text"
                    disabled={readOnly}
                    onClick={() => requestMutation({
                      title: t("移除模板配置", "Remove Template Configuration"),
                      description: t(
                        "移除 Template Configuration 后不能再使用模板创建新图；现有图配置不受影响。",
                        "Removing the Template Configuration prevents new template-created graphs. Existing graph configurations are unchanged.",
                      ),
                      label: t("移除模板", "Remove template"),
                      run: async () => {
                        setConfirmation(null);
                        await perform("remove-template", GRAPH_FACTORY_QUERIES.removeTemplateConfiguration, {}, t("模板配置已移除", "Template Configuration removed"), production);
                      },
                    }, true)}
                  >
                    <Trash2 size={16} />{t("移除", "Remove")}
                  </button>
                )}
              </div>
            </header>
            {factory.templateConfiguration
              ? <ConfigurationPreview configuration={factory.templateConfiguration} revealSensitive={revealSensitive} />
              : <div className="factory-template-empty"><Braces size={21} /><span>{t("尚未创建 Template Configuration", "No Template Configuration has been created")}</span></div>}
          </section>

          <section className="factory-graphs-section">
            <header>
              <div>
                <span className="eyebrow">GRAPH CONFIGURATIONS</span>
                <h2>{t("动态图与 Binding", "Dynamic Graphs and Bindings")}</h2>
              </div>
              <div className="factory-section-actions">
                <button type="button" className="button text" onClick={() => setRevealSensitive((current) => !current)}>
                  {revealSensitive ? <EyeOff size={16} /> : <Eye size={16} />}
                  {revealSensitive ? t("隐藏敏感值", "Hide sensitive values") : t("显示敏感值", "Reveal sensitive values")}
                </button>
              </div>
            </header>

            {factory.graphs.length === 0 ? (
              <EmptyState
                icon={<Database size={28} />}
                title={t("还没有动态图配置", "No dynamic graph configurations")}
                description={t(
                  "创建 Template Configuration 后从模板建图；已有独立后端可在下方高级区域登记。",
                  "Create a Template Configuration and build from it. Existing standalone backends can be registered in the advanced area below.",
                )}
              />
            ) : (
              <div className="factory-graph-layout">
                <div className="factory-graph-list" role="list">
                  {factory.graphs.map((graph) => (
                    <button
                      type="button"
                      key={graph.name}
                      role="listitem"
                      className={selectedGraph === graph.name ? "is-selected" : ""}
                      onClick={() => setSelectedGraph(graph.name)}
                    >
                      <span className="factory-graph-icon"><Database size={18} /></span>
                      <span>
                        <span className="factory-graph-name-line">
                          <strong>{graph.name}</strong>
                          {graph.createdUsingTemplate && <em>{t("模板创建", "From template")}</em>}
                        </span>
                        <small>{graph.traversalSource}</small>
                      </span>
                      <span className="factory-entry-count">{Object.keys(graph.configuration).length}</span>
                    </button>
                  ))}
                </div>
                {selected && (
                  <article className="factory-graph-detail">
                    <header>
                      <div>
                        <span className="eyebrow">DYNAMIC GRAPH</span>
                        <div className="factory-detail-title">
                          <h3>{selected.name}</h3>
                          {selected.createdUsingTemplate && <span className="factory-template-badge"><Braces size={13} />{t("由模板创建", "Created from template")}</span>}
                          {instances.status === "loading" && (
                            <span className="factory-instance-status-chip is-loading"><LoaderCircle className="spin" size={13} />{t("读取实例", "Loading instances")}</span>
                          )}
                          {instances.status === "pending" && instances.graphName === selected.name && (
                            <span className="factory-instance-status-chip is-loading"><RadioTower size={13} />{t("等待节点注册", "Awaiting node registration")}</span>
                          )}
                          {instances.status === "error" && instances.graphName === selected.name && (
                            <span className="factory-instance-status-chip is-warning"><AlertTriangle size={13} />{t("实例读取失败", "Instance check failed")}</span>
                          )}
                          {instances.status === "success" && instances.graphName === selected.name && (
                            <span className={`factory-instance-status-chip ${otherInstanceCount > 0 ? "is-warning" : "is-healthy"}`}>
                              {otherInstanceCount > 0 ? <AlertTriangle size={13} /> : <RadioTower size={13} />}
                              {otherInstanceCount > 0
                                ? t(`${otherInstanceCount} 个其他实例`, `${otherInstanceCount} other instances`)
                                : t("实例正常", "Instances healthy")}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="factory-detail-primary-actions">
                        <button
                          type="button"
                          className="button secondary"
                          disabled={readOnly || busy !== ""}
                          onClick={() => setEditor({
                            scope: "graph",
                            operation: "update",
                            graphName: selected.name,
                            rows: configurationToRows(selected.configuration),
                            initialKeys: Object.keys(selected.configuration),
                          })}
                        >
                          <Pencil size={16} />{t("更新此图配置", "Update this graph")}
                        </button>
                        <button type="button" className="button secondary" disabled={busy !== ""} onClick={() => void manageGraphSchema(selected)}>
                          {busy === `schema:${selected.name}` ? <LoaderCircle className="spin" size={16} /> : <Layers3 size={16} />}{t("管理 Schema", "Manage Schema")}
                        </button>
                        <button type="button" className="button primary" disabled={busy !== ""} onClick={() => void useGraphInQuery(selected)}>
                          {busy === `context:${selected.name}` ? <LoaderCircle className="spin" size={16} /> : <Play size={16} fill="currentColor" />}{t("在查询标签页中使用", "Use in query tab")}
                        </button>
                      </div>
                    </header>
                    <div className="factory-binding-grid">
                      <div><KeyRound size={16} /><span><small>Graph Binding</small><code>{selected.graphBinding}</code></span><button type="button" aria-label={t("复制 Graph Binding", "Copy Graph Binding")} onClick={() => void navigator.clipboard.writeText(selected.graphBinding)}><Copy size={14} /></button></div>
                      <div><Network size={16} /><span><small>Traversal Source</small><code>{selected.traversalSource}</code></span><button type="button" aria-label={t("复制 Traversal Source", "Copy Traversal Source")} onClick={() => void navigator.clipboard.writeText(selected.traversalSource)}><Copy size={14} /></button></div>
                    </div>
                    <ConfigurationPreview configuration={selected.configuration} revealSensitive={revealSensitive} />
                    <section className={`factory-instance-panel ${otherInstanceCount > 0 ? "has-other-instances" : ""}`}>
                      <header>
                        <div>
                          <span className="eyebrow">JANUSGRAPH INSTANCES</span>
                          <strong>{t("集群实例会话", "Cluster Instance Sessions")}</strong>
                          <small>{t(
                            "用于识别阻塞 Schema 操作的失效实例注册，不是 Gremlin 客户端连接列表。",
                            "Identify stale instance registrations that can block schema operations; this is not a Gremlin client connection list.",
                          )}</small>
                        </div>
                        <div className="factory-instance-toolbar">
                          {instances.status === "success" && instances.graphName === selected.name && (
                            <span className="factory-instance-totals">
                              <b>{currentInstanceCount}</b> {t("当前", "current")}
                              <i />
                              <b className={otherInstanceCount > 0 ? "has-warning" : ""}>{otherInstanceCount}</b> {t("其他", "other")}
                            </span>
                          )}
                          {otherInstanceCount > 0 && (
                            <button
                              type="button"
                              className="button danger factory-clear-instances"
                              disabled={readOnly || busy !== ""}
                              onClick={() => forceCloseOtherInstances(selected, selectedInstanceSessions)}
                            >
                              {busy === `instances:all:${selected.name}` ? <LoaderCircle className="spin" size={16} /> : <CircleOff size={16} />}
                              {t("清除全部其他实例", "Clear all other instances")}
                            </button>
                          )}
                          <button type="button" className="button secondary" disabled={instances.status === "loading" || busy !== ""} onClick={() => void loadInstances(selected.name)}>
                            {instances.status === "loading" ? <LoaderCircle className="spin" size={16} /> : <RefreshCw size={16} />}
                            {t("刷新", "Refresh")}
                          </button>
                        </div>
                      </header>
                      {instances.status === "loading" && (
                        <div className="factory-instance-empty"><LoaderCircle className="spin" size={19} /><span>{t("正在读取实例注册", "Loading instance registrations")}</span></div>
                      )}
                      {instances.status === "pending" && instances.graphName === selected.name && (
                        <div className="factory-instance-pending">
                          <span className="factory-instance-pending-icon"><RadioTower size={19} /></span>
                          <div>
                            <strong>{t("等待当前服务实例注册图", "Waiting for this server instance to register the graph")}</strong>
                            <p>{t(
                              "动态图刚创建或当前服务实例尚未加载它。页面会自动重试，也可以立即加载图引用。",
                              "The dynamic graph was just created or is not loaded on this server instance yet. This page retries automatically, or you can load the graph reference now.",
                            )}</p>
                          </div>
                          <button type="button" className="button secondary" disabled={readOnly || busy !== ""} onClick={() => simpleGraphAction(selected, "load")}>
                            {busy === `load:${selected.name}` ? <LoaderCircle className="spin" size={16} /> : <Play size={16} />}
                            {t("立即加载图引用", "Load graph reference now")}
                          </button>
                        </div>
                      )}
                      {instances.status === "error" && instances.graphName === selected.name && (
                        <div className="factory-instance-error" role="alert">
                          <span className="factory-instance-error-icon"><AlertTriangle size={18} /></span>
                          <div>
                            <strong>{instanceConflictId
                              ? t("检测到重复的实例注册", "Duplicate instance registration detected")
                              : t("实例会话读取失败", "Could not load instance sessions")}</strong>
                            <p>{instanceConflictId
                              ? t(
                                `实例 ${instanceConflictId} 已被同名图占用。请确认失效实例已停止，并检查 graph.replace-instance-if-exists 配置。`,
                                `Instance ${instanceConflictId} is already used by the same graph. Confirm the stale instance has stopped and check graph.replace-instance-if-exists.`,
                              )
                              : t("请检查图配置和服务端状态后重试。", "Check the graph configuration and server status, then retry.")}</p>
                            <details><summary>{t("查看技术详情", "View technical details")}</summary><code>{instances.message}</code></details>
                          </div>
                        </div>
                      )}
                      {instances.status === "success" && instances.graphName === selected.name && (
                        <div className="factory-instance-list">
                          {instances.sessions.length === 0 ? (
                            <div className="factory-instance-empty"><CircleOff size={19} /><span>{t("没有读取到实例注册", "No instance registrations found")}</span></div>
                          ) : instances.sessions.map((session) => (
                            <div className={`factory-instance-row ${session.current ? "is-current" : ""}`} key={session.id}>
                              <span className="factory-instance-signal"><span /></span>
                              <div><code>{session.id}</code><small>{session.current ? t("当前实例", "Current instance") : t("其他实例 · 仅异常退出后才能移除", "Other instance · remove only after abnormal termination")}</small></div>
                              {session.current ? (
                                <span className="factory-current-chip">CURRENT</span>
                              ) : (
                                <button type="button" className="button text danger-text" disabled={readOnly || busy !== ""} onClick={() => forceCloseInstance(selected, session)}>
                                  {busy === `instance:${session.id}` ? <LoaderCircle className="spin" size={15} /> : <CircleOff size={15} />}
                                  {t("强制移除", "Force remove")}
                                </button>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </section>
                    <footer className="factory-graph-actions">
                      <div className="factory-reference-actions">
                        <button type="button" className="button secondary" disabled={readOnly || busy !== ""} onClick={() => simpleGraphAction(selected, "reload")}>
                          {busy === `reload:${selected.name}` ? <LoaderCircle className="spin" size={16} /> : <RefreshCw size={16} />}
                          {t("重新加载图引用", "Reload graph reference")}
                        </button>
                        <button type="button" className="button danger ghost factory-close-graph" disabled={readOnly || busy !== ""} onClick={() => simpleGraphAction(selected, "close")}>
                          {busy === `close:${selected.name}` ? <LoaderCircle className="spin" size={16} /> : <CircleOff size={16} />}
                          {t("关闭图", "Close graph")}
                        </button>
                      </div>
                      <button
                        type="button"
                        className="button danger factory-drop-action"
                        disabled={readOnly || busy !== ""}
                        title={production
                          ? t("生产连接：必须完成实例预检并输入完整图名", "Production connection: instance preflight and the full graph name are required")
                          : t("永久删除图、索引数据和 Configuration", "Permanently delete graph data, index data, and its Configuration")}
                        onClick={() => {
                          setDropGraph(selected);
                          setDropPhrase("");
                          void loadInstances(selected.name);
                        }}
                      >
                        <AlertTriangle size={16} />{t("永久删除图", "Drop graph")}
                      </button>
                    </footer>
                  </article>
                )}
              </div>
            )}
            <details className="factory-advanced-registration">
              <summary>
                <span><ServerCog size={17} /></span>
                <div>
                  <strong>{t("高级：登记独立图配置", "Advanced: register standalone graph configuration")}</strong>
                  <small>{t("适用于已有独立后端或必须偏离模板的图", "For existing standalone backends or graphs that must diverge from the template")}</small>
                </div>
                <ChevronRight size={17} />
              </summary>
              <div>
                <p>{t(
                  "登记后会立即尝试打开目标图并验证配置。普通新图建议继续使用 Template Configuration，以保持集群配置一致。",
                  "Registration immediately opens the target graph and verifies its configuration. Continue using Template Configuration for regular new graphs to keep cluster settings consistent.",
                )}</p>
                <button
                  type="button"
                  className="button secondary"
                  disabled={readOnly}
                  onClick={() => setEditor({ scope: "graph", operation: "create", graphName: "", rows: [], initialKeys: [] })}
                >
                  <ServerCog size={16} />{t("登记独立图配置", "Register standalone graph configuration")}
                </button>
              </div>
            </details>
          </section>

          <aside className="factory-propagation-note">
            <Network size={18} />
            <p>{t(
              "动态图 Binding 在集群节点间传播可能需要约 20 秒。Sessioned 标签页若未看到新 Binding，请关闭并重新打开标签页会话。",
              "Dynamic graph bindings can take about 20 seconds to propagate across cluster nodes. If a sessioned tab cannot see a new binding, close and reopen its session.",
            )}</p>
          </aside>
        </>
      )}

      {editor && (
        <ConfigurationEditor editor={editor} busy={busy !== ""} onChange={setEditor} onClose={() => setEditor(null)} onSave={saveConfiguration} />
      )}
      {createGraphName !== null && (
        <Modal title={t("从模板创建动态图", "Create Dynamic Graph from Template")} eyebrow="CREATE DYNAMIC GRAPH" onClose={() => { if (!busy.startsWith("create:")) setCreateGraphName(null); }} width="narrow">
          <form className="factory-create-form" aria-busy={busy.startsWith("create:")} onSubmit={(event) => { event.preventDefault(); if (!busy.startsWith("create:")) createGraph(); }}>
            <label className="field"><span>{t("图名称", "Graph name")}</span><input autoFocus value={createGraphName} maxLength={120} disabled={busy.startsWith("create:")} onChange={(event) => setCreateGraphName(event.target.value)} placeholder="analytics" required /><small>{t("允许字母、数字、点、短横线和下划线", "Letters, numbers, dots, hyphens and underscores")}</small></label>
            <div className="factory-modal-note"><Network size={17} /><span>{t("创建后 Binding 传播可能有短暂延迟。", "Bindings can take a short time to propagate after creation.")}</span></div>
            {busy.startsWith("create:") && (
              <div className="factory-create-progress" role="status" aria-live="polite">
                <LoaderCircle className="spin" size={18} />
                <div><strong>{t("正在创建动态图", "Creating dynamic graph")}</strong><small>{t("正在写入 Configuration、打开后端并注册集群 Binding…", "Writing the configuration, opening the backend, and registering cluster bindings…")}</small></div>
              </div>
            )}
            <footer className="modal-actions"><button type="button" className="button secondary" disabled={busy.startsWith("create:")} onClick={() => setCreateGraphName(null)}>{t("取消", "Cancel")}</button><button type="submit" className="button primary" disabled={busy.startsWith("create:")}>{busy.startsWith("create:") ? <LoaderCircle className="spin" size={17} /> : <Plus size={17} />}{busy.startsWith("create:") ? t("正在创建…", "Creating…") : t("创建图", "Create graph")}</button></footer>
          </form>
        </Modal>
      )}
      {dropGraph && (
        <Modal title={t("永久删除动态图", "Permanently Drop Dynamic Graph")} eyebrow="IRREVERSIBLE OPERATION" onClose={() => setDropGraph(null)} width="narrow">
          <form className="factory-drop-form" onSubmit={(event) => {
            event.preventDefault();
            if (dropPhrase !== dropGraph.name || !dropPreflightReady) return;
            const graph = dropGraph;
            void performDrop(graph);
          }}>
            <div className="factory-drop-warning"><AlertTriangle size={28} /><p>{production
              ? t("当前为生产连接。Drop 会永久删除图数据、索引数据和 Configuration，无法撤销。", "This is a production connection. Drop permanently deletes graph data, index data, and the Configuration. It cannot be undone.")
              : t("Drop 会永久删除图数据、索引数据和 Configuration，无法撤销。", "Drop permanently deletes graph data, index data and the Configuration. It cannot be undone.")}</p></div>
            <section className={`factory-drop-preflight ${dropPreflightReady ? "is-ready" : "is-blocked"}`}>
              <header>
                {dropPreflightReady ? <ShieldCheck size={19} /> : <RadioTower size={19} />}
                <div>
                  <strong>{dropPreflightReady
                    ? t("实例会话预检通过", "Instance session preflight passed")
                    : t("必须先完成实例会话预检", "Instance session preflight is required")}</strong>
                  <small>{dropPreflightReady
                    ? t("仅检测到当前节点；将由 ConfiguredGraphFactory 完成缓存驱逐、后端删除，并校验配置已移除。", "Only this node is registered. ConfiguredGraphFactory will evict caches, delete the backend, and verify the configuration is gone.")
                    : dropOtherInstanceCount > 0
                      ? t(`仍有 ${dropOtherInstanceCount} 个其他实例注册。请返回集群实例会话区，确认节点已停止后清除这些注册。`, `${dropOtherInstanceCount} other instance registrations remain. Return to the cluster sessions panel and clear them only after confirming those nodes have stopped.`)
                      : t("动态图必须先在当前服务实例中加载并成功读取实例列表。此限制用于规避 ConfiguredGraphFactory.drop 在残留实例上挂起的问题。", "The graph must be loaded on the current server instance and its instance list read successfully. This prevents ConfiguredGraphFactory.drop from hanging on stale instances.")}</small>
                </div>
              </header>
              <div>
                <span><b>{dropCurrentInstanceCount}</b> {t("当前实例", "current")}</span>
                <span className={dropOtherInstanceCount > 0 ? "has-warning" : ""}><b>{dropOtherInstanceCount}</b> {t("其他实例", "other")}</span>
                <button type="button" className="button text" disabled={busy !== "" || instances.status === "loading"} onClick={() => void loadInstances(dropGraph.name)}>
                  {instances.status === "loading" ? <LoaderCircle className="spin" size={15} /> : <RefreshCw size={15} />}
                  {t("重新检查", "Recheck")}
                </button>
              </div>
            </section>
            <label className="field"><span>{t(`输入“${dropGraph.name}”以确认`, `Type “${dropGraph.name}” to confirm`)}</span><input autoFocus value={dropPhrase} onChange={(event) => setDropPhrase(event.target.value)} autoComplete="off" /></label>
            <footer className="modal-actions"><button type="button" className="button secondary" onClick={() => setDropGraph(null)}>{t("取消", "Cancel")}</button><button type="submit" className="button danger" disabled={dropPhrase !== dropGraph.name || !dropPreflightReady || busy !== ""}>{busy ? <LoaderCircle className="spin" size={17} /> : <Trash2 size={17} />}{t("永久删除", "Drop permanently")}</button></footer>
          </form>
        </Modal>
      )}
      {clearOtherInstances && (
        <Modal
          title={t("确认清除其他实例", "Confirm Clearing Other Instances")}
          eyebrow="CLUSTER SAFETY CHECK"
          onClose={() => { if (!busy.startsWith("instances:all:")) setClearOtherInstances(null); }}
          width="narrow"
        >
          <form className="factory-drop-form" onSubmit={(event) => {
            event.preventDefault();
            void confirmForceCloseOtherInstances();
          }}>
            <div className="factory-drop-warning">
              <AlertTriangle size={28} />
              <p>{t(
                `将强制清除“${clearOtherInstances.graph.name}”的 ${clearOtherInstances.count} 个非当前实例注册。请先确认对应 JanusGraph 节点均已停止，否则可能造成数据不一致。当前实例会被保留。`,
                `This force-removes ${clearOtherInstances.count} non-current instance registrations from “${clearOtherInstances.graph.name}”. Confirm that every corresponding JanusGraph node has stopped, or data inconsistency may result. The current instance is preserved.`,
              )}</p>
            </div>
            <label className="field">
              <span>{t(
                `输入“${clearOtherInstances.graph.name}”以确认实例均已停止`,
                `Type “${clearOtherInstances.graph.name}” to confirm the instances are stopped`,
              )}</span>
              <input
                autoFocus
                value={clearInstancesPhrase}
                disabled={busy.startsWith("instances:all:")}
                onChange={(event) => setClearInstancesPhrase(event.target.value)}
                autoComplete="off"
              />
            </label>
            <footer className="modal-actions">
              <button type="button" className="button secondary" disabled={busy.startsWith("instances:all:")} onClick={() => setClearOtherInstances(null)}>{t("取消", "Cancel")}</button>
              <button type="submit" className="button danger" disabled={clearInstancesPhrase !== clearOtherInstances.graph.name || busy !== ""}>
                {busy.startsWith("instances:all:") ? <LoaderCircle className="spin" size={17} /> : <CircleOff size={17} />}
                {t(`清除 ${clearOtherInstances.count} 个实例`, `Clear ${clearOtherInstances.count} instances`)}
              </button>
            </footer>
          </form>
        </Modal>
      )}
      {confirmation && (
        <ConfirmDialog
          title={confirmation.title}
          description={confirmation.description}
          confirmLabel={confirmation.label}
          confirmIcon={<AlertTriangle size={17} />}
          onCancel={() => setConfirmation(null)}
          onConfirm={confirmation.run}
        />
      )}
    </div>
  );
}
