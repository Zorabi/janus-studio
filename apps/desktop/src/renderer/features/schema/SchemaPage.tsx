import type {
  ConnectionSummary,
  QueryExecutionResult,
  SchemaJob,
} from "@janusgraph/domain";
import {
  AlertTriangle,
  CircleDot,
  Database,
  GitBranch,
  KeyRound,
  Layers3,
  LoaderCircle,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  ShieldCheck,
  Waypoints,
} from "lucide-react";
import {
  type FormEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useState,
} from "react";
import { SelectControl } from "../../components/SelectControl";
import { EmptyState, PageHeader } from "../../components/ui";
import {
  schemaCatalogFromRows,
  schemaRowsFromItems,
} from "../../lib/gremlin-completion";
import { safeIdentifier, stringLiteral } from "../../lib/gremlin-identifiers";
import { useTranslate } from "../../lib/i18n";
import { errorMessage } from "../../lib/presentation";
import type { QueryState } from "../query/query-workspace";

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

