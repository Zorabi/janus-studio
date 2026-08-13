import type {
  ConnectionSummary,
  QueryExecutionResult,
  SchemaJob,
} from "@janusgraph/domain";
import { routeCompatibility } from "@janusgraph/application";
import {
  AlertTriangle,
  Boxes,
  CheckCircle2,
  ChevronRight,
  CircleDot,
  Database,
  Download,
  FileJson,
  GitCompareArrows,
  History,
  KeyRound,
  Layers3,
  LoaderCircle,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  TerminalSquare,
  Upload,
  Waypoints,
} from "lucide-react";
import {
  type FormEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { SelectControl } from "../../components/SelectControl";
import { ConfirmDialog, EmptyState, Modal, PageHeader } from "../../components/ui";
import {
  schemaCatalogFromRows,
  schemaRowsFromItems,
} from "../../lib/gremlin-completion";
import { safeIdentifier, stringLiteral } from "../../lib/gremlin-identifiers";
import { useTranslate } from "../../lib/i18n";
import { dynamicGraphContext, type DynamicGraphContext } from "../../lib/dynamic-graph-context";
import {
  GRAPH_FACTORY_PROBE_QUERY,
  GRAPH_FACTORY_QUERIES,
  parseGraphFactoryState,
  type ConfiguredGraphSummary,
} from "../../lib/configured-graph-factory";
import { errorMessage } from "../../lib/presentation";
import {
  buildExistingPropertyIndexScript,
  buildPropertyKeySchemaScript,
  sortSchemaNames,
  type SchemaIndexElement,
} from "../../lib/schema-create";
import {
  compareSchemaRows,
  parseSchemaSnapshotBaseline,
  schemaSnapshotRows,
  type SchemaSnapshotBaseline,
} from "../../lib/schema-snapshot";
import {
  BACKGROUND_SCHEMA_TASK_STORAGE_KEY,
  findBackgroundSchemaJob,
  parseBackgroundSchemaTask,
  type BackgroundSchemaTask,
} from "../../lib/schema-background-task";
import {
  createOfficialSchemaDefinition,
  createSchemaArchive,
  formatSchemaArchiveTime,
  parseSchemaArchive,
  planSchemaImport,
  type SchemaArchive,
  type SchemaImportPlan,
} from "../../lib/schema-files";
import type { QueryState, ToastState } from "../query/query-workspace";
import { SchemaHistory } from "./SchemaHistory";
import { SchemaExportDialog, type SchemaExportFormat } from "./SchemaExportDialog";
import { SchemaImportDialog } from "./SchemaImportDialog";
import { SchemaSnapshotDialog } from "./SchemaSnapshotDialog";

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
    def indexOnly = null
    try { indexOnly = mgmt.getIndexOnlyConstraint(index.name())?.name() } catch (Throwable ignored) {}
    rows << [group: "graphIndexes", name: index.name(), element: "${element}", type: index.isMixedIndex() ? "MIXED" : "COMPOSITE", unique: index.isUnique(), backingIndex: index.getBackingIndex(), fields: fields.collect { key -> key.name() }, indexOnly: indexOnly, fieldStatus: statuses, status: statuses.values().toSet().join(", ") ?: "UNKNOWN"]
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
                {value.indexOnly ? ` · ${t("限定", "Only")} ${String(value.indexOnly)}` : ""}
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
  element,
  vertexLabels,
  edgeLabels,
  onElementChange,
  t,
  includeName = false,
  nameField = "name",
}: {
  mixed: boolean;
  element: SchemaIndexElement;
  vertexLabels: string[];
  edgeLabels: string[];
  onElementChange: (value: SchemaIndexElement) => void;
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
          value={element}
          onValueChange={(value) => onElementChange(value === "Edge" ? "Edge" : "Vertex")}
          options={[
            { value: "Vertex", label: "Vertex" },
            { value: "Edge", label: "Edge" },
          ]}
        />
      </label>
      {(
        <label className="field field-span-2 index-only-field">
          <span>{element === "Vertex"
            ? t("限定 Vertex Label", "Limit to Vertex Label")
            : t("限定 Edge Label", "Limit to Edge Label")}</span>
          <SelectControl
            name="indexOnlySchemaLabel"
            ariaLabel={element === "Vertex" ? t("限定 Vertex Label", "Limit to Vertex Label") : t("限定 Edge Label", "Limit to Edge Label")}
            defaultValue=""
            options={[
              { value: "", label: t("不限定（全局索引）", "No limit (global index)") },
              ...(element === "Vertex" ? vertexLabels : edgeLabels).map((label) => ({ value: label, label, description: "indexOnly" })),
            ]}
          />
          <small>{t(
            "选择后会调用 indexOnly(schemaLabel)，索引只覆盖该类型。",
            "When selected, indexOnly(schemaLabel) limits the index to that type.",
          )}</small>
        </label>
      )}
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

export function SchemaPage({
  activeConnection,
  connectionProfile,
  graphContext,
  execute,
  onGraphContextChange,
  onOpenQueryContext,
  onOpenGraphFactory,
  notify,
}: {
  activeConnection: ConnectionSummary | undefined;
  connectionProfile: ConnectionSummary | undefined;
  graphContext: DynamicGraphContext | null;
  execute: (query: string, productionConfirmed?: boolean) => Promise<QueryExecutionResult>;
  onGraphContextChange: (context: DynamicGraphContext | null) => void;
  onOpenQueryContext: (context: DynamicGraphContext) => void;
  onOpenGraphFactory: () => void;
  notify: (toast: ToastState) => void;
}) {
  const t = useTranslate();
  const [section, setSection] = useState<"definitions" | "history">("definitions");
  const [state, setState] = useState<QueryState>({ status: "idle" });
  const [kind, setKind] = useState<"property" | "vertex" | "edge" | "index">(
    "property",
  );
  const [propertyComposite, setPropertyComposite] = useState(false);
  const [propertyMixed, setPropertyMixed] = useState(false);
  const [propertyIndexElement, setPropertyIndexElement] = useState<SchemaIndexElement>("Vertex");
  const [existingIndexType, setExistingIndexType] = useState<
    "composite" | "mixed"
  >("composite");
  const [existingIndexElement, setExistingIndexElement] = useState<SchemaIndexElement>("Vertex");
  const [busy, setBusy] = useState(false);
  const [indexBusy, setIndexBusy] = useState("");
  const [schemaWarnings, setSchemaWarnings] = useState<string[]>([]);
  const [schemaExportDialogOpen, setSchemaExportDialogOpen] = useState(false);
  const [schemaSnapshotDialogOpen, setSchemaSnapshotDialogOpen] = useState(false);
  const [schemaSnapshotBaseline, setSchemaSnapshotBaseline] = useState<SchemaSnapshotBaseline | null>(null);
  const [schemaJobs, setSchemaJobs] = useState<SchemaJob[]>([]);
  const [schemaImport, setSchemaImport] = useState<{
    fileName: string;
    archive: SchemaArchive;
    plan: SchemaImportPlan;
  } | null>(null);
  const [backgroundSchemaImport, setBackgroundSchemaImport] = useState<{
    fileName: string;
    archive: SchemaArchive;
    plan: SchemaImportPlan;
  } | null>(null);
  const [backgroundSchemaTask, setBackgroundSchemaTask] = useState<BackgroundSchemaTask | null>(() =>
    parseBackgroundSchemaTask(localStorage.getItem(BACKGROUND_SCHEMA_TASK_STORAGE_KEY)),
  );
  const schemaImportStartedAt = useRef("");
  const [schemaImportFailure, setSchemaImportFailure] = useState<string | null>(null);
  const [schemaImportConfirmationOpen, setSchemaImportConfirmationOpen] = useState(false);
  const [schemaTransferBusy, setSchemaTransferBusy] = useState<"import" | "export-studio" | "export-official" | null>(null);
  const [schemaCancelRequested, setSchemaCancelRequested] = useState(false);
  const [schemaBatchIndex, setSchemaBatchIndex] = useState(0);
  const [factoryGraphs, setFactoryGraphs] = useState<ConfiguredGraphSummary[]>([]);
  const [factoryAvailable, setFactoryAvailable] = useState(false);
  const [factoryGraphsLoading, setFactoryGraphsLoading] = useState(false);
  const [pendingSchemaCreate, setPendingSchemaCreate] = useState<{
    script: string;
    form: HTMLFormElement;
    definitionName: string;
    createsIndex: boolean;
    indexNames: string[];
    targetName: string;
    production: boolean;
  } | null>(null);
  const [pendingIndexAction, setPendingIndexAction] = useState<{
    name: string;
    action: string;
  } | null>(null);
  const schemaContextKey = activeConnection
    ? graphContext
      ? `${activeConnection.id}.${graphContext.traversalSource}`
      : activeConnection.id
    : "";
  const schemaSnapshotKey = schemaContextKey
    ? `janusgraph.schemaSnapshot.v1.${schemaContextKey}`
    : "";
  const schemaTargetName = graphContext?.name ?? activeConnection?.graphBinding ?? t("当前图", "Current graph");

  const rememberBackgroundSchemaTask = (task: BackgroundSchemaTask | null) => {
    setBackgroundSchemaTask(task);
    if (task) localStorage.setItem(BACKGROUND_SCHEMA_TASK_STORAGE_KEY, JSON.stringify(task));
    else localStorage.removeItem(BACKGROUND_SCHEMA_TASK_STORAGE_KEY);
  };

  const refreshJobs = useCallback(async () => {
    if (!window.janusGraphDesktop) {
      setSchemaJobs([]);
      return;
    }
    setSchemaJobs(await window.janusGraphDesktop.schemaJobs.list());
  }, []);

  const backgroundSchemaJob = findBackgroundSchemaJob(schemaJobs, backgroundSchemaTask);
  const hasRunningSchemaImport = backgroundSchemaJob?.status === "running" || schemaJobs.some((job) =>
    job.status === "running" &&
    job.action === "IMPORT_SCHEMA" &&
    job.connectionId === activeConnection?.id,
  );

  useEffect(() => {
    if (!backgroundSchemaTask || backgroundSchemaTask.jobId || !backgroundSchemaJob) return;
    rememberBackgroundSchemaTask({ ...backgroundSchemaTask, jobId: backgroundSchemaJob.id });
  }, [backgroundSchemaJob?.id, backgroundSchemaTask?.jobId]);

  useEffect(() => {
    if (schemaTransferBusy !== "import" && !hasRunningSchemaImport) return;
    void refreshJobs();
    const interval = window.setInterval(() => { void refreshJobs(); }, 500);
    return () => window.clearInterval(interval);
  }, [schemaTransferBusy, hasRunningSchemaImport, refreshJobs]);

  useEffect(() => {
    setSchemaSnapshotBaseline(parseSchemaSnapshotBaseline(schemaSnapshotKey ? localStorage.getItem(schemaSnapshotKey) : null));
    setSchemaSnapshotDialogOpen(false);
    setSchemaExportDialogOpen(false);
  }, [schemaSnapshotKey]);

  const refreshFactoryGraphs = useCallback(async () => {
    if (!activeConnection) {
      setFactoryGraphs([]);
      setFactoryAvailable(false);
      return;
    }
    setFactoryGraphsLoading(true);
    try {
      const profile = await window.janusGraphDesktop?.compatibility.get(activeConnection.id);
      if (routeCompatibility(profile, "configuredGraphFactory").status === "unavailable") {
        setFactoryGraphs([]);
        setFactoryAvailable(false);
        return;
      }
      const result = await execute(GRAPH_FACTORY_PROBE_QUERY);
      const factoryState = parseGraphFactoryState(result.items);
      setFactoryGraphs(factoryState?.graphs ?? []);
      setFactoryAvailable(Boolean(factoryState && (factoryState.graphs.length > 0 || factoryState.templateConfiguration)));
    } catch {
      setFactoryGraphs([]);
      setFactoryAvailable(false);
    } finally {
      setFactoryGraphsLoading(false);
    }
  }, [activeConnection?.id, execute]);

  const refresh = useCallback(async () => {
    if (!activeConnection) return;
    setState({ status: "loading" });
    setSchemaWarnings([]);
    try {
      const profile = await window.janusGraphDesktop?.compatibility.get(activeConnection.id);
      if (routeCompatibility(profile, "schemaManagement").status === "unavailable") {
        throw new Error(t(
          "能力探测确认当前服务端不支持 JanusGraph Schema Management API。",
          "Capability detection confirmed that the server does not support the JanusGraph Schema Management API.",
        ));
      }
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
        `janusgraph.schemaCatalog.v1.${schemaContextKey}`,
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
  }, [activeConnection, execute, schemaContextKey, t]);

  useEffect(() => {
    if (activeConnection) {
      void refresh();
    }
    void refreshJobs();
    void refreshFactoryGraphs();
  }, [schemaContextKey]);

  const selectGraphContext = async (value: string) => {
    if (!activeConnection || value === (graphContext?.name ?? "")) return;
    if (!value) {
      onGraphContextChange(null);
      return;
    }
    const graph = factoryGraphs.find((candidate) => candidate.name === value);
    if (!graph) return;
    setFactoryGraphsLoading(true);
    try {
      await execute(GRAPH_FACTORY_QUERIES.openGraph.replaceAll("graphName", stringLiteral(graph.name)));
      onGraphContextChange(dynamicGraphContext(activeConnection.id, graph));
    } catch (error) {
      notify({ tone: "error", message: errorMessage(error) });
    } finally {
      setFactoryGraphsLoading(false);
    }
  };

  const executeSchemaCreate = async (
    script: string,
    form: HTMLFormElement,
    productionConfirmed = false,
  ) => {
    setBusy(true);
    try {
      await execute(script, productionConfirmed);
      form.reset();
      setPropertyComposite(false);
      setPropertyMixed(false);
      setPropertyIndexElement("Vertex");
      setExistingIndexType("composite");
      setExistingIndexElement("Vertex");
      await refresh();
    } catch (error) {
      setState({ status: "error", message: errorMessage(error) });
    } finally {
      setBusy(false);
    }
  };

  const create = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!activeConnection) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const name = String(data.get("name") ?? "").trim();
    const graph = safeIdentifier(activeConnection.graphBinding);
    let script = "";
    let createsIndex = false;
    let indexNames: string[] = [];
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
      const indexOnlySchemaLabel = String(data.get("indexOnlySchemaLabel") ?? "").trim();
      const backend = String(data.get("mixedIndexBackend") ?? "search").trim();
      const unique = data.get("compositeUnique") === "on";
      createsIndex = createComposite || createMixed;
      indexNames = [
        ...(createComposite ? [compositeIndexName] : []),
        ...(createMixed ? [mixedIndexName] : []),
      ].filter(Boolean);
      script = buildPropertyKeySchemaScript({
        graphBinding: activeConnection.graphBinding,
        name,
        dataType,
        cardinality,
        element: indexElement,
        schemaLabel: indexOnlySchemaLabel,
        ...(createComposite ? { composite: { name: compositeIndexName, unique } } : {}),
        ...(createMixed ? { mixed: { name: mixedIndexName, backend } } : {}),
      });
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
      const indexOnlySchemaLabel = String(data.get("indexOnlySchemaLabel") ?? "").trim();
      const unique = data.get("unique") === "on";
      createsIndex = true;
      indexNames = [name];
      script = buildExistingPropertyIndexScript({
        graphBinding: activeConnection.graphBinding,
        indexName: name,
        propertyKey,
        type: indexType === "mixed" ? "mixed" : "composite",
        element: indexElement,
        schemaLabel: indexOnlySchemaLabel,
        unique,
        backend,
      });
    }
    const production = activeConnection.environment === "prod";
    setPendingSchemaCreate({
      script,
      form,
      definitionName: name,
      createsIndex,
      indexNames,
      targetName: schemaTargetName,
      production,
    });
  };

  const updateIndex = async (name: string, action: string, confirmed = false) => {
    if (!activeConnection) return;
    if (!confirmed && (action === "REMOVE_INDEX" || activeConnection.environment === "prod")) {
      setPendingIndexAction({ name, action });
      return;
    }
    const graph = safeIdentifier(activeConnection.graphBinding);
    setIndexBusy(`${name}:${action}`);
    try {
      const profile = await window.janusGraphDesktop?.compatibility.get(activeConnection.id);
      if (routeCompatibility(profile, "schemaIndexLifecycle").status === "unavailable") {
        throw new Error(t(
          "当前服务端缺少所需的索引状态或等待 API，已阻止索引生命周期操作。",
          "The server lacks the required index status or await API, so the index lifecycle operation was blocked.",
        ));
      }
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
        productionConfirmed: activeConnection.environment === "prod" && confirmed,
      });
      notify({
        tone: "success",
        message: `${t("Schema 操作已完成", "Schema operation completed")} · ${name} · ${action}`,
        dismissOnly: true,
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

  const retrySchemaJob = async (job: SchemaJob) => {
    if (!window.janusGraphDesktop) return;
    if (job.action === "IMPORT_SCHEMA") {
      setSection("definitions");
      notify({
        tone: "info",
        message: t(
          "Schema 导入不会直接重放旧批次。请刷新目标 Schema 后重新选择文件，以当前状态生成幂等导入计划。",
          "Schema imports do not replay stale batches. Refresh the target Schema and select the file again to generate an idempotent plan from current state.",
        ),
        dismissOnly: true,
      });
      return;
    }
    setIndexBusy(`retry:${job.id}`);
    try {
      const completed = await window.janusGraphDesktop.schemaJobs.retry(job.id);
      notify({
        tone: "success",
        message: `${t("Schema 操作已完成", "Schema operation completed")} · ${completed.indexName} · ${completed.action}`,
        dismissOnly: true,
      });
      await refreshJobs();
      await refresh();
    } catch (error) {
      setState({ status: "error", message: errorMessage(error) });
      await refreshJobs();
    } finally {
      setIndexBusy("");
    }
  };

  const dismissSchemaJob = async (job: SchemaJob) => {
    if (!window.janusGraphDesktop) return;
    setIndexBusy(`dismiss:${job.id}`);
    try {
      await window.janusGraphDesktop.schemaJobs.dismiss(job.id);
      if (backgroundSchemaJob?.id === job.id) rememberBackgroundSchemaTask(null);
      await refreshJobs();
    } catch (error) {
      setState({ status: "error", message: errorMessage(error) });
    } finally {
      setIndexBusy("");
    }
  };

  const saveSchemaSnapshot = () => {
    if (!schemaSnapshotKey || state.status !== "success" || schemaWarnings.length > 0) return;
    const snapshot = {
      savedAt: new Date().toISOString(),
      rows: schemaSnapshotRows(state.result.items),
    } satisfies SchemaSnapshotBaseline;
    localStorage.setItem(schemaSnapshotKey, JSON.stringify(snapshot));
    setSchemaSnapshotBaseline(snapshot);
    notify({ tone: "success", message: t("Schema 比较基线已更新", "Schema comparison baseline updated") });
  };
  const schemaDiff = state.status === "success" && schemaSnapshotBaseline && schemaWarnings.length === 0
    ? compareSchemaRows(schemaSnapshotBaseline.rows, schemaSnapshotRows(state.result.items))
    : null;

  const exportSchema = async (format: SchemaExportFormat) => {
    if (!activeConnection || state.status !== "success" || !window.janusGraphDesktop) return;
    setSchemaTransferBusy(format === "studio" ? "export-studio" : "export-official");
    try {
      const document = format === "studio"
        ? createSchemaArchive(state.result.items, {
            connectionName: activeConnection.name,
            graphBinding: activeConnection.graphBinding,
            traversalSource: activeConnection.traversalSource,
          })
        : createOfficialSchemaDefinition(state.result.items);
      const safeName = schemaTargetName.trim().replace(/[^\p{L}\p{N}._-]+/gu, "-") || "graph";
      const path = await window.janusGraphDesktop.files.saveSchemaFile({
        suggestedName: format === "studio"
          ? `${safeName}.schema.json`
          : `${safeName}.janusgraph-schema.json`,
        content: `${JSON.stringify(document, null, 2)}\n`,
      });
      if (path) {
        setSchemaExportDialogOpen(false);
        notify({
          tone: "success",
          message: format === "studio"
            ? t("Janus Studio Schema 归档已导出", "Janus Studio Schema archive exported")
            : t("JanusGraph 官方 JSON 已导出，可直接用于 JsonSchemaInitStrategy", "Official JanusGraph JSON exported for direct use with JsonSchemaInitStrategy"),
        });
      }
    } catch (error) {
      notify({ tone: "error", message: errorMessage(error) });
    } finally {
      setSchemaTransferBusy(null);
    }
  };

  const selectSchemaImport = async () => {
    if (!activeConnection || state.status !== "success" || !window.janusGraphDesktop) return;
    setSchemaImportFailure(null);
    setSchemaTransferBusy("import");
    try {
      const file = await window.janusGraphDesktop.files.pickSchemaFile();
      if (!file) return;
      const archive = parseSchemaArchive(file);
      const profile = await window.janusGraphDesktop.compatibility.get(activeConnection.id);
      const officialRoute = routeCompatibility(profile, "officialSchemaJson");
      setSchemaImport({
        fileName: file.name,
        archive,
        plan: planSchemaImport(
          archive,
          state.result.items,
          activeConnection.graphBinding,
          activeConnection.traversalSource,
          officialRoute.status,
        ),
      });
      setBackgroundSchemaImport(null);
      setSchemaBatchIndex(0);
    } catch (error) {
      notify({ tone: "error", message: errorMessage(error) });
    } finally {
      setSchemaTransferBusy(null);
    }
  };

  const applySchemaImport = async () => {
    if (!activeConnection || !schemaImport || !window.janusGraphDesktop) return;
    if (schemaImport.plan.conflicts.length > 0 || !schemaImport.plan.script) return;
    setSchemaTransferBusy("import");
    setSchemaImportFailure(null);
    setSchemaCancelRequested(false);
    schemaImportStartedAt.current = new Date().toISOString();
    try {
      if (schemaImport.plan.execution === "official-json") {
        const profile = await window.janusGraphDesktop.compatibility.get(activeConnection.id);
        if (routeCompatibility(profile, "officialSchemaJson").status !== "available") {
          throw new Error(t(
            "目标连接的 JanusGraph 官方 JSON Schema API 当前不可用，请重新探测能力并生成导入计划。",
            "The JanusGraph official JSON Schema API is not currently available for the target connection. Refresh capabilities and regenerate the import plan.",
          ));
        }
      }
      await window.janusGraphDesktop.schemaJobs.run({
        connectionId: activeConnection.id,
        indexName: schemaImport.fileName,
        action: "IMPORT_SCHEMA",
        query: schemaImport.plan.script,
        queries: schemaImport.plan.scripts,
        productionConfirmed: activeConnection.environment === "prod",
      });
      notify({
        tone: "success",
        message: `${t("Schema 导入并校验完成", "Schema import and verification completed")} · ${schemaImport.plan.execution === "official-json" ? "JsonSchemaInitStrategy" : "Management API"} · ${schemaImport.plan.operations.length} ${t("项定义已创建", "definitions created")} · ${schemaImport.plan.indexActivations.length} ${t("个索引已启用", "indexes enabled")}`,
        dismissOnly: true,
      });
      setSchemaImport(null);
      setBackgroundSchemaImport(null);
      await refreshJobs();
      await refresh();
    } catch (error) {
      const message = errorMessage(error);
      notify({ tone: /stopped|停止/i.test(message) ? "info" : "error", message });
      setSchemaImportFailure(message);
      setBackgroundSchemaImport(null);
      await refreshJobs().catch(() => undefined);
      await refresh();
    } finally {
      setSchemaTransferBusy(null);
      setSchemaCancelRequested(false);
    }
  };

  const cancelSchemaImport = async () => {
    if (!activeConnection || !window.janusGraphDesktop || schemaCancelRequested) return;
    setSchemaCancelRequested(true);
    try {
      const cancelled = await window.janusGraphDesktop.schemaJobs.cancel(activeConnection.id);
      if (!cancelled) setSchemaCancelRequested(false);
    } catch (error) {
      setSchemaCancelRequested(false);
      notify({ tone: "error", message: errorMessage(error) });
    }
  };

  const trackedSchemaImportName = schemaImport?.fileName ?? backgroundSchemaImport?.fileName;
  const runningSchemaImport = schemaJobs.find((job) =>
    job.status === "running" &&
    job.action === "IMPORT_SCHEMA" &&
    job.connectionId === activeConnection?.id &&
    (!trackedSchemaImportName || job.indexName === trackedSchemaImportName),
  );
  const progressSchemaImport = backgroundSchemaJob?.status === "running" ? backgroundSchemaJob : runningSchemaImport;
  const visibleBackgroundSchemaJob = backgroundSchemaJob ?? (!schemaImport ? runningSchemaImport : undefined);
  const schemaProgressMatch = progressSchemaImport?.message.match(/(?:Running batch|Completed)\s+(\d+)\/(\d+)/i);
  const schemaImportProgress = schemaProgressMatch
    ? {
        current: Number(schemaProgressMatch[1]),
        total: Number(schemaProgressMatch[2]),
        message: progressSchemaImport?.message ?? "",
      }
    : null;
  const vertexLabelOptions = state.status === "success"
    ? sortSchemaNames([...new Set(
        schemaRowsFromItems(state.result.items)
          .filter((row) => row.group === "vertexLabels")
          .map((row) => String(row.name ?? "").trim())
          .filter(Boolean),
      )])
    : [];
  const edgeLabelOptions = state.status === "success"
    ? sortSchemaNames([...new Set(
        schemaRowsFromItems(state.result.items)
          .filter((row) => row.group === "edgeLabels")
          .map((row) => String(row.name ?? "").trim())
          .filter(Boolean),
      )])
    : [];

  const schemaDefinitionActions = (
    <div className="schema-local-actions">
      <button type="button" className="button text" onClick={() => void selectSchemaImport()} disabled={state.status !== "success" || schemaTransferBusy !== null}>
        {schemaTransferBusy === "import" ? <LoaderCircle className="spin" size={16} /> : <Upload size={16} />}
        {t("导入 Schema", "Import Schema")}
      </button>
      <button
        type="button"
        className="button text"
        onClick={() => setSchemaExportDialogOpen(true)}
        disabled={state.status !== "success" || schemaTransferBusy !== null}
      >
        {schemaTransferBusy === "export-official" || schemaTransferBusy === "export-studio" ? <LoaderCircle className="spin" size={16} /> : <Download size={16} />}
        {t("导出 Schema", "Export Schema")}
      </button>
      <button
        type="button"
        className="button text"
        onClick={() => setSchemaSnapshotDialogOpen(true)}
        disabled={state.status !== "success"}
      >
        <GitCompareArrows size={16} />
        {t("快照基线", "Snapshot baseline")}
      </button>
      <button type="button" className="button secondary" onClick={refresh} disabled={!activeConnection || state.status === "loading"}>
        <RefreshCw className={state.status === "loading" ? "spin" : ""} size={17} />{t("刷新 Schema")}
      </button>
    </div>
  );

  return (
    <div className="page-scroll schema-page">
      <PageHeader
        eyebrow="JANUSGRAPH MANAGEMENT"
        title={t("Schema 管理")}
        description={
          section === "definitions"
            ? t(
                "结构化展示 Vertex Label、Edge Label、Property Key 和 Graph Index；支持 Composite 与 Mixed Index。",
                "Inspect Vertex Labels, Edge Labels, Property Keys and Graph Indexes; create Composite and Mixed indexes.",
              )
            : t(
                "集中查看本机保存的 Schema 操作状态、耗时与恢复入口。",
                "Review locally stored Schema operation status, duration and recovery actions.",
              )
        }
        actions={
          section === "history" ? (
            <button type="button" className="button secondary" onClick={() => void refreshJobs()}>
              <RefreshCw size={17} />
              {t("刷新", "Refresh")}
            </button>
          ) : undefined
        }
      />
      {activeConnection && (
        <section className={`schema-context-strip ${graphContext ? "is-dynamic" : ""}`} aria-label={t("Schema 图上下文", "Schema graph context")}>
          <div className="schema-context-node">
            <span><Database size={16} /></span>
            <div><small>{t("连接", "Connection")}</small><strong>{activeConnection.name}</strong></div>
          </div>
          <ChevronRight className="schema-context-arrow" size={18} />
          <div className="schema-context-node is-graph">
            <span>{graphContext ? <Boxes size={16} /> : <Layers3 size={16} />}</span>
            <div className={factoryAvailable || graphContext ? "schema-context-graph-picker" : ""}>
              <small>{graphContext ? t("动态图", "Dynamic graph") : t("连接默认图", "Connection default graph")}</small>
              {factoryAvailable || graphContext ? (
                <SelectControl
                  value={graphContext?.name ?? ""}
                  ariaLabel={t("切换 Schema 图", "Switch Schema graph")}
                  disabled={factoryGraphsLoading}
                  onValueChange={(value) => void selectGraphContext(value)}
                  options={[
                    { value: "", label: t("连接默认图", "Connection default graph"), description: connectionProfile?.graphBinding ?? activeConnection.graphBinding },
                    ...factoryGraphs.map((graph) => ({ value: graph.name, label: graph.name, description: graph.traversalSource })),
                  ]}
                />
              ) : <strong>{activeConnection.graphBinding}</strong>}
            </div>
          </div>
          <div className="schema-context-bindings">
            <code>{activeConnection.graphBinding}</code>
            <span>g →</span>
            <code>{activeConnection.traversalSource}</code>
          </div>
          <div className="schema-context-actions">
            {graphContext && (
              <button type="button" className="button text" onClick={() => onOpenQueryContext(graphContext)}>
                <TerminalSquare size={15} />{t("在查询中打开", "Open in query")}
              </button>
            )}
            {(factoryAvailable || graphContext) && (
              <button type="button" className="button text" onClick={onOpenGraphFactory}>
                <Boxes size={15} />{t("动态图管理", "Dynamic graphs")}
              </button>
            )}
            {graphContext && (
              <button type="button" className="button secondary" onClick={() => onGraphContextChange(null)}>
                {t("返回连接默认图", "Use connection default")}
              </button>
            )}
          </div>
        </section>
      )}
      <div className="schema-section-toolbar">
        <nav className="schema-section-tabs" aria-label={t("Schema 页面", "Schema pages")}>
          <button
          type="button"
          className={section === "definitions" ? "is-active" : ""}
          aria-current={section === "definitions" ? "page" : undefined}
          onClick={() => setSection("definitions")}
        >
          <Layers3 size={17} />
          {t("Schema 定义", "Schema definitions")}
          </button>
          <button
          type="button"
          className={section === "history" ? "is-active" : ""}
          aria-current={section === "history" ? "page" : undefined}
          onClick={() => setSection("history")}
        >
          <History size={17} />
          {t("操作历史", "Operation history")}
          {schemaJobs.length > 0 && <span>{schemaJobs.length}</span>}
          </button>
        </nav>
        {section === "definitions" && schemaDefinitionActions}
      </div>
      {!schemaImport && visibleBackgroundSchemaJob && (
        <section className={`schema-background-import is-${visibleBackgroundSchemaJob.status}`} role={visibleBackgroundSchemaJob.status === "failed" ? "alert" : "status"} aria-live="polite">
          {visibleBackgroundSchemaJob.status === "running"
            ? <LoaderCircle className="spin" size={18} />
            : visibleBackgroundSchemaJob.status === "succeeded"
              ? <CheckCircle2 size={18} />
              : <AlertTriangle size={18} />}
          <div>
            <strong>{visibleBackgroundSchemaJob.status === "running"
              ? t("Schema 正在后台导入", "Schema import is running in the background")
              : visibleBackgroundSchemaJob.status === "succeeded"
                ? t("Schema 后台导入成功", "Background Schema import succeeded")
                : visibleBackgroundSchemaJob.status === "interrupted"
                  ? t("Schema 后台导入已中断", "Background Schema import was interrupted")
                  : t("Schema 后台导入失败", "Background Schema import failed")}</strong>
            <small>{visibleBackgroundSchemaJob.indexName}{visibleBackgroundSchemaJob.message ? ` · ${visibleBackgroundSchemaJob.message}` : ""}{schemaImportProgress ? ` · ${schemaImportProgress.current} / ${schemaImportProgress.total}` : ""}</small>
            {visibleBackgroundSchemaJob.status === "running" && <progress value={schemaImportProgress?.current ?? 0} max={schemaImportProgress?.total ?? 1} />}
          </div>
          {visibleBackgroundSchemaJob.status === "running" ? (
            <>
              <button type="button" className="button text" onClick={() => {
                if (backgroundSchemaImport) {
                  setSchemaImport(backgroundSchemaImport);
                  setBackgroundSchemaImport(null);
                } else setSection("history");
              }}>
                <FileJson size={16} />{backgroundSchemaImport ? t("查看进度", "View progress") : t("查看任务", "View job")}
              </button>
              <button type="button" className="button secondary" disabled={schemaCancelRequested} onClick={() => void cancelSchemaImport()}>
                {schemaCancelRequested ? <LoaderCircle className="spin" size={16} /> : <CircleDot size={16} />}
                {schemaCancelRequested ? t("正在停止…", "Stopping…") : t("停止导入", "Stop import")}
              </button>
            </>
          ) : (
            <>
              <button type="button" className="button text" onClick={() => { setSection("history"); rememberBackgroundSchemaTask(null); }}>
                <History size={16} />{t("查看操作历史", "View operation history")}
              </button>
              <button type="button" className="button secondary" onClick={() => rememberBackgroundSchemaTask(null)}>
                <CheckCircle2 size={16} />{t("知道了", "Dismiss")}
              </button>
            </>
          )}
        </section>
      )}
      {section === "history" ? (
        <SchemaHistory
          jobs={schemaJobs}
          busy={Boolean(indexBusy)}
          onRetry={(job) => void retrySchemaJob(job)}
          onDismiss={(job) => void dismissSchemaJob(job)}
        />
      ) : !activeConnection ? (
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
                <strong>{graphContext?.name ?? activeConnection.name}</strong>
                <small className="schema-binding">
                  {graphContext && <>{activeConnection.name} · </>}Management: {activeConnection.graphBinding} · g →{" "}
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
                    <button type="button" className="schema-diff-summary" onClick={() => setSchemaSnapshotDialogOpen(true)}>
                      <GitCompareArrows size={17} />
                      <span className="schema-diff-summary-copy">
                        <strong>{t("自动比较快照基线", "Automatic baseline comparison")}</strong>
                        <small>{schemaSnapshotBaseline?.savedAt
                          ? `${t("基线", "Baseline")} · ${formatSchemaArchiveTime(schemaSnapshotBaseline.savedAt)}`
                          : t("旧版本快照", "Legacy snapshot")}</small>
                      </span>
                      <span className="is-added">+{schemaDiff.added.length}</span>
                      <span className="is-changed">~{schemaDiff.changed.length}</span>
                      <span className="is-missing" title={t("当前缺失", "Missing now")}>!{schemaDiff.missing.length}</span>
                      <small>{t("查看明细", "View details")}</small>
                    </button>
                  )}
                  <SchemaOverview
                    items={state.result.items}
                    onIndexAction={(name, action) => void updateIndex(name, action)}
                    indexBusy={indexBusy}
                  />
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
                          value={propertyIndexElement}
                          onValueChange={(value) => setPropertyIndexElement(value === "Edge" ? "Edge" : "Vertex")}
                          options={[
                            { value: "Vertex", label: "Vertex" },
                            { value: "Edge", label: "Edge" },
                          ]}
                        />
                      </label>
                    )}
                    {(propertyComposite || propertyMixed) && (
                      <label className="field index-only-field">
                        <span>{propertyIndexElement === "Vertex"
                          ? t("限定 Vertex Label", "Limit to Vertex Label")
                          : t("限定 Edge Label", "Limit to Edge Label")}</span>
                        <SelectControl
                          name="indexOnlySchemaLabel"
                          ariaLabel={propertyIndexElement === "Vertex" ? t("限定 Vertex Label", "Limit to Vertex Label") : t("限定 Edge Label", "Limit to Edge Label")}
                          defaultValue=""
                          options={[
                            { value: "", label: t("不限定（全局索引）", "No limit (global index)") },
                            ...(propertyIndexElement === "Vertex" ? vertexLabelOptions : edgeLabelOptions)
                              .map((label) => ({ value: label, label, description: "indexOnly" })),
                          ]}
                        />
                        <small>{t(
                          "Composite 与 Mixed Index 将只覆盖所选 Schema Label。",
                          "Composite and Mixed indexes will only cover the selected Schema Label.",
                        )}</small>
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
                  <IndexFields
                    mixed={existingIndexType === "mixed"}
                    element={existingIndexElement}
                    vertexLabels={vertexLabelOptions}
                    edgeLabels={edgeLabelOptions}
                    onElementChange={setExistingIndexElement}
                    t={t}
                  />
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
      {schemaExportDialogOpen && state.status === "success" && (
        <SchemaExportDialog
          graphName={schemaTargetName}
          unavailableReasons={schemaWarnings.length > 0
            ? {
                official: t("部分 Schema 分组读取失败。请先刷新并确保所有分组读取成功，避免导出不完整文件。", "Some Schema groups failed to load. Refresh until every group succeeds to avoid exporting an incomplete file."),
                studio: t("部分 Schema 分组读取失败。请先刷新并确保所有分组读取成功，避免导出不完整文件。", "Some Schema groups failed to load. Refresh until every group succeeds to avoid exporting an incomplete file."),
              }
            : {}}
          busy={schemaTransferBusy === "export-official"
            ? "official"
            : schemaTransferBusy === "export-studio"
              ? "studio"
              : null}
          onClose={() => { if (!schemaTransferBusy) setSchemaExportDialogOpen(false); }}
          onExport={(format) => void exportSchema(format)}
        />
      )}
      {schemaSnapshotDialogOpen && state.status === "success" && (
        <SchemaSnapshotDialog
          graphName={schemaTargetName}
          currentCount={schemaSnapshotRows(state.result.items).length}
          savedAt={schemaSnapshotBaseline?.savedAt ?? ""}
          baselineCount={schemaSnapshotBaseline?.rows.length ?? 0}
          diff={schemaDiff}
          incomplete={schemaWarnings.length > 0}
          onClose={() => setSchemaSnapshotDialogOpen(false)}
          onSave={saveSchemaSnapshot}
        />
      )}
      {schemaImport && !schemaImportConfirmationOpen && (
        <SchemaImportDialog
          activeConnection={activeConnection}
          graphContext={graphContext}
          value={schemaImport}
          busy={schemaTransferBusy === "import"}
          cancelRequested={schemaCancelRequested}
          failureMessage={schemaImportFailure}
          progress={schemaImportProgress}
          onClose={() => {
            setSchemaImportConfirmationOpen(false);
            setSchemaImport(null);
          }}
          onBackground={() => {
            setBackgroundSchemaImport(schemaImport);
            setSchemaImport(null);
            if (activeConnection) {
              rememberBackgroundSchemaTask({
                connectionId: activeConnection.id,
                fileName: schemaImport.fileName,
                startedAt: schemaImportStartedAt.current || new Date().toISOString(),
                jobId: runningSchemaImport?.id,
              });
            }
          }}
          onCancel={() => void cancelSchemaImport()}
          onRegenerate={() => void selectSchemaImport()}
          onApply={() => setSchemaImportConfirmationOpen(true)}
        />
      )}
      {schemaImport && schemaImportConfirmationOpen && (
        <ConfirmDialog
          title={t("确认导入 Schema", "Confirm Schema Import")}
          description={`${t("即将把已审阅的 Schema 计划写入目标图", "The reviewed Schema plan will be written to target graph")} “${schemaTargetName}”。${t(
            `计划包含 ${schemaImport.plan.operations.length} 个创建项、${schemaImport.plan.indexActivations.length} 个高影响索引操作；已识别的相同定义会跳过。`,
            `The plan contains ${schemaImport.plan.operations.length} creates and ${schemaImport.plan.indexActivations.length} high-impact index operations; matching definitions will be skipped.`,
          )}`}
          confirmLabel={t("确认并导入", "Confirm and Import")}
          confirmIcon={<Upload size={17} />}
          confirmationText={schemaTargetName}
          tone="primary"
          onCancel={() => setSchemaImportConfirmationOpen(false)}
          onConfirm={async () => {
            setSchemaImportConfirmationOpen(false);
            await applySchemaImport();
          }}
        />
      )}
      {false && ((schemaImport, activeConnection, graphContext) => (
        <Modal
          eyebrow="SCHEMA IMPORT PLAN"
          title={t("审阅 Schema 导入计划", "Review Schema Import Plan")}
          onClose={() => {
            if (!schemaTransferBusy) setSchemaImport(null);
          }}
          width="xwide"
        >
          <div className="schema-import-dialog">
            <div className="schema-import-source">
              <FileJson size={22} />
              <div>
                <strong>{schemaImport.fileName}</strong>
                <small>
                  {t("来源", "Source")}: {schemaImport.archive.source.connectionName} · {formatSchemaArchiveTime(schemaImport.archive.exportedAt)}
                </small>
              </div>
              <span>{schemaImport.archive.format}</span>
            </div>
            <div className={`schema-import-target ${activeConnection?.environment === "prod" ? "is-production" : ""}`}>
              {activeConnection?.environment === "prod" ? <AlertTriangle size={18} /> : <Database size={18} />}
              <div>
                <span>{t("目标图连接", "Target graph connection")}</span>
                <strong>{activeConnection
                  ? graphContext
                    ? `${activeConnection.name} / ${graphContext.name}`
                    : activeConnection.name
                  : t("未选择连接", "No connection selected")}</strong>
              </div>
              {activeConnection?.environment === "prod" && (
                <small>{t(
                  "这是生产连接。确认导入即表示允许执行下方已审阅的 Schema 写入计划。",
                  "This is a production connection. Confirming the import authorizes the reviewed schema write plan below.",
                )}</small>
              )}
            </div>
            <div className="schema-import-stats">
              <article className="is-create">
                <strong>{schemaImport.plan.operations.length}</strong>
                <span>{t("待创建", "To create")}</span>
              </article>
              <article className="is-skip">
                <strong>{schemaImport.plan.skipped.length}</strong>
                <span>{t("相同并跳过", "Matching and skipped")}</span>
              </article>
              <article className="is-activate">
                <strong>{schemaImport.plan.indexActivations.length}</strong>
                <span>{t("待启用索引", "Indexes to enable")}</span>
              </article>
              <article className="is-conflict">
                <strong>{schemaImport.plan.conflicts.length}</strong>
                <span>{t("冲突", "Conflicts")}</span>
              </article>
            </div>
            <div className="schema-import-notice">
              <ShieldCheck size={18} />
              <div>
                <strong>{t("安全的增量导入", "Safe additive import")}</strong>
                <small>{t(
                  `只创建目标图中缺少的定义；不会删除或覆盖已有 Schema。将按依赖顺序执行 ${schemaImport.plan.scripts.length} 个小批次，每批提交后立即回读校验。导入期间可以请求停止，已提交批次会保留。`,
                  `Only missing definitions are created; existing schema is never deleted or overwritten. ${schemaImport.plan.scripts.length} dependency-ordered batches are verified after each commit. You can request a stop during import; committed batches are retained.`,
                )}</small>
              </div>
            </div>
            {schemaImport.plan.indexActivations.length > 0 && (
              <div className="schema-import-index-note">
                <AlertTriangle size={18} />
                <div>
                  <strong>{t("索引将自动完成生命周期", "Index lifecycle is automated")}</strong>
                  <small>{t(
                    "定义创建后会依次执行 REGISTER_INDEX 与 REINDEX，并回读确认所有字段达到 ENABLED。重建已有数据索引可能耗时较长。",
                    "After definitions are created, REGISTER_INDEX and REINDEX run in sequence and all fields are verified as ENABLED. Reindexing existing data can take time.",
                  )}</small>
                </div>
              </div>
            )}
            {schemaImport.plan.conflicts.length > 0 && (
              <section className="schema-import-conflicts" role="alert">
                <header>
                  <AlertTriangle size={17} />
                  <strong>{t("必须先解决冲突", "Resolve conflicts before importing")}</strong>
                </header>
                {schemaImport.plan.conflicts.map((conflict) => (
                  <div key={`${conflict.key}:${conflict.reason}`}>
                    <code>{conflict.key}</code>
                    <span>{conflict.reason}</span>
                  </div>
                ))}
              </section>
            )}
            <section className="schema-import-operations">
              <header>
                <strong>{t("变更清单", "Change set")}</strong>
                <span>{schemaImport.plan.operations.length + schemaImport.plan.indexActivations.length}</span>
              </header>
              {schemaImport.plan.operations.length + schemaImport.plan.indexActivations.length > 0 ? (
                <div>
                  {schemaImport.plan.operations.map((item) => (
                    <article key={`${item.group}:${item.name}`}>
                      <CheckCircle2 size={15} />
                      <span>{item.summary}</span>
                      <code>{item.group}</code>
                    </article>
                  ))}
                  {schemaImport.plan.indexActivations.map((name) => (
                    <article key={`activate:${name}`}>
                      <RefreshCw size={15} />
                      <span>{t(`启用 Graph Index · ${name}`, `Enable Graph Index · ${name}`)}</span>
                      <code>REGISTER → REINDEX</code>
                    </article>
                  ))}
                </div>
              ) : (
                <p>{t("目标图已经包含归档中的全部定义。", "The target graph already contains every archived definition.")}</p>
              )}
            </section>
            {schemaImport.plan.script && (
              <details className="schema-import-script">
                <summary>{t(
                  `查看 ${schemaImport.plan.scripts.length} 个 Gremlin 批次`,
                  `Inspect ${schemaImport.plan.scripts.length} Gremlin batches`,
                )}</summary>
                <div className="schema-import-batch-list">
                  <nav aria-label={t("Gremlin 批次", "Gremlin batches")}>
                    {schemaImport.plan.scripts.map((_script, index) => (
                      <button
                        type="button"
                        key={`schema-import-batch-${index + 1}`}
                        className={schemaBatchIndex === index ? "is-active" : ""}
                        aria-current={schemaBatchIndex === index ? "true" : undefined}
                        onClick={() => setSchemaBatchIndex(index)}
                      >
                        <span>{String(index + 1).padStart(2, "0")}</span>
                        {t(`批次 ${index + 1}`, `Batch ${index + 1}`)}
                      </button>
                    ))}
                  </nav>
                  <pre>{schemaImport.plan.scripts[schemaBatchIndex] ?? ""}</pre>
                </div>
              </details>
            )}
            <footer className="schema-import-actions">
              <button
                type="button"
                className="button secondary"
                disabled={schemaCancelRequested}
                onClick={() => schemaTransferBusy === "import" ? void cancelSchemaImport() : setSchemaImport(null)}
              >
                {schemaCancelRequested && <LoaderCircle className="spin" size={17} />}
                {schemaTransferBusy === "import"
                  ? schemaCancelRequested ? t("正在停止…", "Stopping…") : t("停止导入", "Stop import")
                  : t("取消", "Cancel")}
              </button>
              <button
                type="button"
                className="button primary"
                disabled={
                  schemaTransferBusy !== null ||
                  schemaImport.plan.conflicts.length > 0 ||
                  !schemaImport.plan.script
                }
                onClick={() => void applySchemaImport()}
              >
                {schemaTransferBusy === "import" ? <LoaderCircle className="spin" size={17} /> : <Upload size={17} />}
                {t("确认并导入", "Confirm and Import")}
              </button>
            </footer>
          </div>
        </Modal>
      ))(schemaImport!, activeConnection!, graphContext!)}
      {pendingSchemaCreate && activeConnection && (
        <ConfirmDialog
          title={pendingSchemaCreate.createsIndex
            ? t("确认创建 Graph Index", "Confirm Graph Index Creation")
            : t("确认创建 Schema 定义", "Confirm Schema Definition Creation")}
          description={pendingSchemaCreate.createsIndex
            ? `${pendingSchemaCreate.production ? `${t("生产连接", "Production connection")} “${activeConnection.name}” · ` : ""}${t(
                "即将在目标图中创建 Graph Index。",
                "A Graph Index will be created in the target graph.",
              )} ${t("目标图", "Target graph")}：“${pendingSchemaCreate.targetName}”${pendingSchemaCreate.indexNames.length > 0
                ? ` · ${t("索引", "Index")}：“${pendingSchemaCreate.indexNames.join("、")}”`
                : ""}。${t(
                "索引创建会修改 Schema，请核对目标图后继续。",
                "Index creation changes the schema. Verify the target graph before continuing.",
              )}`
            : `${pendingSchemaCreate.production ? `${t("生产连接", "Production connection")} “${activeConnection.name}” · ` : ""}${t(
                "即将在目标图中创建新的 Schema 定义。",
                "A new Schema definition will be created in the target graph.",
              )} ${t("目标图", "Target graph")}：“${pendingSchemaCreate.targetName}” · ${t("名称", "Name")}：“${pendingSchemaCreate.definitionName}”。${t(
                "Schema 写入会立即提交，请核对目标图和定义名称后继续。",
                "The Schema write commits immediately. Verify the target graph and definition name before continuing.",
              )}`}
          confirmLabel={pendingSchemaCreate.createsIndex
            ? t("确认创建索引", "Create Index")
            : t("确认创建", "Confirm Creation")}
          confirmIcon={<AlertTriangle size={17} />}
          confirmationText={pendingSchemaCreate.targetName}
          tone="primary"
          onCancel={() => setPendingSchemaCreate(null)}
          onConfirm={async () => {
            const pending = pendingSchemaCreate;
            setPendingSchemaCreate(null);
            await executeSchemaCreate(pending.script, pending.form, pending.production);
          }}
        />
      )}
      {pendingIndexAction && activeConnection && (
        <ConfirmDialog
          title={
            pendingIndexAction.action === "REMOVE_INDEX"
              ? t("确认永久删除索引", "Confirm Permanent Index Removal")
              : t("确认生产环境索引操作", "Confirm Production Index Operation")
          }
          description={
            pendingIndexAction.action === "REMOVE_INDEX"
              ? `${t("索引", "Index")} “${pendingIndexAction.name}” · ${t(
                  "此操作不可撤销，而且只有已禁用的索引才能删除。",
                  "This action cannot be undone, and only a disabled index can be removed.",
                )}`
              : `${t("生产连接", "Production connection")} “${activeConnection.name}” · ${pendingIndexAction.name} · ${pendingIndexAction.action}. ${t(
                  "索引生命周期操作可能持续较长时间并影响线上查询。",
                  "Index lifecycle operations can be long-running and may affect production queries.",
                )}`
          }
          confirmLabel={t("确认执行", "Confirm Operation")}
          confirmIcon={<AlertTriangle size={17} />}
          onCancel={() => setPendingIndexAction(null)}
          onConfirm={async () => {
            const pending = pendingIndexAction;
            setPendingIndexAction(null);
            await updateIndex(pending.name, pending.action, true);
          }}
        />
      )}
    </div>
  );
}
