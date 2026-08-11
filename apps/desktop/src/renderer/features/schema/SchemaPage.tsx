import type {
  ConnectionSummary,
  QueryExecutionResult,
  SchemaJob,
} from "@janusgraph/domain";
import {
  AlertTriangle,
  Boxes,
  CheckCircle2,
  ChevronRight,
  CircleDot,
  Database,
  Download,
  FileJson,
  GitBranch,
  History,
  KeyRound,
  Layers3,
  LoaderCircle,
  Plus,
  RefreshCw,
  Save,
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
  BACKGROUND_SCHEMA_TASK_STORAGE_KEY,
  findBackgroundSchemaJob,
  parseBackgroundSchemaTask,
  type BackgroundSchemaTask,
} from "../../lib/schema-background-task";
import {
  createSchemaArchive,
  formatSchemaArchiveTime,
  parseSchemaArchive,
  planSchemaImport,
  type SchemaArchive,
  type SchemaImportPlan,
} from "../../lib/schema-files";
import type { QueryState, ToastState } from "../query/query-workspace";
import { SchemaHistory } from "./SchemaHistory";
import { SchemaImportDialog } from "./SchemaImportDialog";

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
  const [existingIndexType, setExistingIndexType] = useState<
    "composite" | "mixed"
  >("composite");
  const [busy, setBusy] = useState(false);
  const [indexBusy, setIndexBusy] = useState("");
  const [schemaWarnings, setSchemaWarnings] = useState<string[]>([]);
  const [schemaDiff, setSchemaDiff] = useState<ReturnType<typeof compareSchemaRows> | null>(null);
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
  const [schemaTransferBusy, setSchemaTransferBusy] = useState<"import" | "export" | null>(null);
  const [schemaCancelRequested, setSchemaCancelRequested] = useState(false);
  const [schemaBatchIndex, setSchemaBatchIndex] = useState(0);
  const [factoryGraphs, setFactoryGraphs] = useState<ConfiguredGraphSummary[]>([]);
  const [factoryAvailable, setFactoryAvailable] = useState(false);
  const [factoryGraphsLoading, setFactoryGraphsLoading] = useState(false);
  const [pendingSchemaCreate, setPendingSchemaCreate] = useState<{
    script: string;
    form: HTMLFormElement;
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

  const refreshFactoryGraphs = useCallback(async () => {
    if (!activeConnection) {
      setFactoryGraphs([]);
      setFactoryAvailable(false);
      return;
    }
    setFactoryGraphsLoading(true);
    try {
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
      setExistingIndexType("composite");
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
    if (activeConnection.environment === "prod") {
      setPendingSchemaCreate({ script, form });
      return;
    }
    void executeSchemaCreate(script, form);
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

  const schemaSnapshotKey = schemaContextKey
    ? `janusgraph.schemaSnapshot.v1.${schemaContextKey}`
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

  const exportSchema = async () => {
    if (!activeConnection || state.status !== "success" || !window.janusGraphDesktop) return;
    setSchemaTransferBusy("export");
    try {
      const archive = createSchemaArchive(state.result.items, {
        connectionName: activeConnection.name,
        graphBinding: activeConnection.graphBinding,
        traversalSource: activeConnection.traversalSource,
      });
      const safeName = (graphContext?.name ?? activeConnection.name).trim().replace(/[^\p{L}\p{N}._-]+/gu, "-") || "graph";
      const path = await window.janusGraphDesktop.files.saveSchemaFile({
        suggestedName: `${safeName}.schema.json`,
        content: `${JSON.stringify(archive, null, 2)}\n`,
      });
      if (path) {
        notify({
          tone: "success",
          message: t("Schema 已导出", "Schema exported"),
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
      setSchemaImport({
        fileName: file.name,
        archive,
        plan: planSchemaImport(
          archive,
          state.result.items,
          activeConnection.graphBinding,
          activeConnection.traversalSource,
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
        message: `${t("Schema 导入并校验完成", "Schema import and verification completed")} · ${schemaImport.plan.operations.length} ${t("项定义已创建", "definitions created")} · ${schemaImport.plan.indexActivations.length} ${t("个索引已启用", "indexes enabled")}`,
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

  const schemaDefinitionActions = (
    <div className="schema-local-actions">
      <button type="button" className="button text" onClick={() => void selectSchemaImport()} disabled={state.status !== "success" || schemaTransferBusy !== null}>
        {schemaTransferBusy === "import" ? <LoaderCircle className="spin" size={16} /> : <Upload size={16} />}
        {t("导入 Schema", "Import Schema")}
      </button>
      <button type="button" className="button text" onClick={() => void exportSchema()} disabled={state.status !== "success" || schemaTransferBusy !== null}>
        {schemaTransferBusy === "export" ? <LoaderCircle className="spin" size={16} /> : <Download size={16} />}
        {t("导出 Schema", "Export Schema")}
      </button>
      <button type="button" className="button text" onClick={saveSchemaSnapshot} disabled={state.status !== "success"}>
        <Save size={16} />{t("保存快照", "Save snapshot")}
      </button>
      <button type="button" className="button text" onClick={compareSchemaSnapshot} disabled={state.status !== "success"}>
        <GitBranch size={16} />{t("比较快照", "Compare snapshot")}
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
      {schemaImport && (
        <SchemaImportDialog
          activeConnection={activeConnection}
          graphContext={graphContext}
          value={schemaImport}
          busy={schemaTransferBusy === "import"}
          cancelRequested={schemaCancelRequested}
          failureMessage={schemaImportFailure}
          progress={schemaImportProgress}
          onClose={() => setSchemaImport(null)}
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
          onApply={() => void applySchemaImport()}
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
          title={t("确认生产环境 Schema 变更", "Confirm Production Schema Change")}
          description={`${t("生产连接", "Production connection")} “${activeConnection.name}”. ${t(
            "即将创建新的 Schema 定义；请再次确认目标连接和表单内容均正确。",
            "A new schema definition will be created. Verify the target connection and form values before continuing.",
          )}`}
          confirmLabel={t("确认创建", "Confirm Creation")}
          confirmIcon={<AlertTriangle size={17} />}
          onCancel={() => setPendingSchemaCreate(null)}
          onConfirm={async () => {
            const pending = pendingSchemaCreate;
            setPendingSchemaCreate(null);
            await executeSchemaCreate(pending.script, pending.form, true);
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
