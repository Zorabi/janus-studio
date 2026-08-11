import { decodeGraphValue } from "./result-model";

export type GraphFactoryConfiguration = Record<string, unknown>;

export type ConfiguredGraphSummary = {
  name: string;
  graphBinding: string;
  traversalSource: string;
  createdUsingTemplate: boolean;
  configuration: GraphFactoryConfiguration;
};

export type ConfiguredGraphFactoryState = {
  graphs: ConfiguredGraphSummary[];
  templateConfiguration: GraphFactoryConfiguration | null;
};

export type ConfigurationRow = {
  id: string;
  key: string;
  value: string;
  valueType: "string" | "number" | "boolean" | "json";
};

const FACTORY = "org.janusgraph.core.ConfiguredGraphFactory";
const MAP_CONFIGURATION = "org.apache.commons.configuration2.MapConfiguration";
const REUSE_OR_OPEN_GRAPH = `def __manager = org.janusgraph.core.JanusGraphManagerUtility.getInstance()
def __graph = __manager == null ? null : __manager.getGraph(graphName)
if (__graph == null || !__graph.isOpen()) { __graph = ${FACTORY}.open(graphName) }`;

export const GRAPH_FACTORY_PROBE_QUERY = `def __readConfiguration = { __configuration ->
  if (__configuration == null) { return null }
  if (__configuration instanceof Map) { return new LinkedHashMap(__configuration) }
  def __values = new LinkedHashMap()
  __configuration.getKeys().each { __key -> __values.put(__key, __configuration.getProperty(__key)) }
  return __values
}
def __names = ${FACTORY}.getGraphNames().toList().sort()
return [[
  graphs: __names.collect { __name -> [
    name: __name,
    graphBinding: __name,
    traversalSource: ${FACTORY}.toTraversalSourceName(__name),
    configuration: __readConfiguration(${FACTORY}.getConfiguration(__name)) ?: [:]
  ] },
  templateConfiguration: __readConfiguration(${FACTORY}.getTemplateConfiguration())
]]`;

export const GRAPH_FACTORY_QUERIES = {
  createGraph: `${FACTORY}.create(graphName); return graphName`,
  openGraph: `${FACTORY}.open(graphName); return graphName`,
  reloadGraph: `def __manager = org.janusgraph.core.JanusGraphManagerUtility.getInstance()
def __graph = __manager == null ? null : __manager.getGraph(graphName)
if (__graph != null && __graph.isOpen()) { ${FACTORY}.close(graphName) }
def __reloaded = ${FACTORY}.open(graphName)
if (__reloaded == null || !__reloaded.isOpen()) {
  throw new IllegalStateException("Graph reference could not be reloaded: " + graphName)
}
return [[graphName: graphName, reloaded: true]]`,
  closeGraph: `${FACTORY}.close(graphName); return graphName`,
  dropGraph: `def __manager = org.janusgraph.core.JanusGraphManagerUtility.getInstance()
def __graph = __manager == null ? null : __manager.getGraph(graphName)
if (__graph == null || !__graph.isOpen()) {
  throw new IllegalStateException("DROP_PREFLIGHT_REQUIRED: Open the graph on this node and refresh its instance sessions before dropping it")
}
def __management = __graph.openManagement()
def __otherInstances = []
try {
  __otherInstances = __management.getOpenInstances().toList().findAll { __raw -> !__raw.endsWith("(current)") }.sort()
} finally {
  if (__management != null && __management.isOpen()) { __management.rollback() }
}
if (!__otherInstances.isEmpty()) {
  throw new IllegalStateException("DROP_BLOCKED_OPEN_INSTANCES: " + __otherInstances.join(", "))
}
${FACTORY}.drop(graphName)
def __configuration = null
def __stillRegistered = true
for (int __attempt = 0; __attempt < 20 && (__configuration != null || __stillRegistered); __attempt++) {
  __configuration = ${FACTORY}.getConfiguration(graphName)
  __stillRegistered = ${FACTORY}.getGraphNames().contains(graphName)
  if (__configuration != null || __stillRegistered) { Thread.sleep(250) }
}
if (__configuration != null || __stillRegistered) {
  throw new IllegalStateException("DROP_VERIFICATION_FAILED: Dynamic graph is still registered: " + graphName)
}
return [[graphName: graphName, verified: true]]`,
  createConfiguration: `def __values = new LinkedHashMap(configuration)
__values.put("graph.graphname", graphName)
${FACTORY}.createConfiguration(new ${MAP_CONFIGURATION}(__values))
def __actual = ${FACTORY}.getConfiguration(graphName)
if (__actual == null) { throw new IllegalStateException("Registered graph configuration was not found: " + graphName) }
def __graph = ${FACTORY}.open(graphName)
if (__graph == null || !__graph.isOpen()) { throw new IllegalStateException("Registered graph could not be opened: " + graphName) }
return [[graphName: graphName, configuration: __actual, opened: true]]`,
  updateConfiguration: `def __removedKeys = new LinkedHashSet(removedKeys)
__removedKeys.remove("graph.graphname")
if (!__removedKeys.isEmpty()) { ${FACTORY}.removeConfiguration(graphName, __removedKeys) }
def __values = new LinkedHashMap(configuration)
__values.put("graph.graphname", graphName)
${FACTORY}.updateConfiguration(graphName, new ${MAP_CONFIGURATION}(__values))
def __actual = ${FACTORY}.getConfiguration(graphName)
if (__actual == null) { throw new IllegalStateException("Updated graph configuration was not found: " + graphName) }
def __mismatched = __values.findAll { __key, __value -> !__actual.containsKey(__key) || __actual.get(__key) != __value }.keySet()
def __notRemoved = __removedKeys.findAll { __key -> __actual.containsKey(__key) }
if (!__mismatched.isEmpty() || !__notRemoved.isEmpty()) {
  throw new IllegalStateException("Graph configuration verification failed: mismatched=" + __mismatched + ", notRemoved=" + __notRemoved)
}
return [[graphName: graphName, configuration: __actual]]`,
  createTemplateConfiguration: `${FACTORY}.createTemplateConfiguration(new ${MAP_CONFIGURATION}(new LinkedHashMap(configuration))); return true`,
  updateTemplateConfiguration: `${FACTORY}.updateTemplateConfiguration(new ${MAP_CONFIGURATION}(new LinkedHashMap(configuration))); return true`,
  replaceTemplateConfiguration: `def __previous = ${FACTORY}.getTemplateConfiguration()
${FACTORY}.removeTemplateConfiguration()
try {
  ${FACTORY}.createTemplateConfiguration(new ${MAP_CONFIGURATION}(new LinkedHashMap(configuration)))
  return true
} catch (Throwable __error) {
  if (__previous != null) { ${FACTORY}.createTemplateConfiguration(new ${MAP_CONFIGURATION}(new LinkedHashMap(__previous))) }
  throw __error
}`,
  removeTemplateConfiguration: `${FACTORY}.removeTemplateConfiguration(); return true`,
  listInstances: `def __manager = org.janusgraph.core.JanusGraphManagerUtility.getInstance()
def __graph = __manager == null ? null : __manager.getGraph(graphName)
if (__graph == null || !__graph.isOpen()) { return [[available: false, sessions: []]] }
def __management = __graph.openManagement()
try {
  def __sessions = __management.getOpenInstances().toList().sort().collect { __raw ->
    def __current = __raw.endsWith("(current)")
    def __id = __current ? __raw.substring(0, __raw.length() - "(current)".length()).trim() : __raw
    return [id: __id, current: __current]
  }
  return [[available: true, sessions: __sessions]]
} finally {
  if (__management != null && __management.isOpen()) { __management.rollback() }
}`,
  forceCloseInstance: `${REUSE_OR_OPEN_GRAPH}
def __management = __graph.openManagement()
try {
  __management.forceCloseInstance(instanceId)
  __management.commit()
  return instanceId
} catch (Throwable __error) {
  if (__management != null && __management.isOpen()) { __management.rollback() }
  throw __error
}`,
  forceCloseOtherInstances: `${REUSE_OR_OPEN_GRAPH}
def __management = __graph.openManagement()
try {
  def __otherInstances = __management.getOpenInstances().toList().findAll { __raw -> !__raw.endsWith("(current)") }.sort()
  __otherInstances.each { __instanceId -> __management.forceCloseInstance(__instanceId) }
  __management.commit()
  return __otherInstances
} catch (Throwable __error) {
  if (__management != null && __management.isOpen()) { __management.rollback() }
  throw __error
}`,
} as const;

function recordOf(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function configurationOf(value: unknown): GraphFactoryConfiguration {
  const decoded = decodeGraphValue(value);
  if (Array.isArray(decoded)) {
    return Object.assign(
      {},
      ...decoded.map(recordOf).filter(
        (entry): entry is Record<string, unknown> => entry !== null,
      ),
    );
  }
  return recordOf(decoded) ?? {};
}

export function parseGraphFactoryState(
  items: unknown[],
): ConfiguredGraphFactoryState | null {
  const decodedItems = decodeGraphValue(items);
  const values = (Array.isArray(decodedItems) ? decodedItems : [decodedItems])
    .flatMap((value) => Array.isArray(value) ? value : [value]);
  const records = values.map(recordOf).filter(
    (value): value is Record<string, unknown> => value !== null,
  );
  const root: Record<string, unknown> = Object.assign({}, ...records);
  if (!root || !Array.isArray(root.graphs)) return null;

  const graphs = root.graphs.flatMap((candidate) => {
    const graph = recordOf(candidate);
    if (!graph) return [];
    const name = typeof graph.name === "string" ? graph.name.trim() : "";
    if (!name) return [];
    return [{
      name,
      graphBinding:
        typeof graph.graphBinding === "string" && graph.graphBinding
          ? graph.graphBinding
          : name,
      traversalSource:
        typeof graph.traversalSource === "string" && graph.traversalSource
          ? graph.traversalSource
          : `${name}_traversal`,
      configuration: configurationOf(graph.configuration),
      createdUsingTemplate: isTemplateCreatedConfiguration(
        configurationOf(graph.configuration),
      ),
    }];
  }).sort((left, right) => left.name.localeCompare(right.name, undefined, {
    numeric: true,
    sensitivity: "base",
  }));

  return {
    graphs,
    templateConfiguration:
      root.templateConfiguration === null || root.templateConfiguration === undefined
        ? null
        : configurationOf(root.templateConfiguration),
  };
}

export function parseConfigurationJson(value: string): GraphFactoryConfiguration {
  const parsed = JSON.parse(value) as unknown;
  const configuration = recordOf(parsed);
  if (!configuration) throw new Error("Configuration JSON 必须是对象");
  return configuration;
}

export function configurationToRows(
  configuration: GraphFactoryConfiguration,
): ConfigurationRow[] {
  return Object.entries(configuration)
    .sort(([left], [right]) => left.localeCompare(right, undefined, {
      numeric: true,
      sensitivity: "base",
    }))
    .map(([key, value]) => ({
      id: crypto.randomUUID(),
      key,
      value: typeof value === "string" ? value : JSON.stringify(value) ?? "null",
      valueType:
        typeof value === "string"
          ? "string" as const
          : typeof value === "number"
            ? "number" as const
            : typeof value === "boolean"
              ? "boolean" as const
              : "json" as const,
    }));
}

function rowValue(row: ConfigurationRow): unknown {
  const trimmed = row.value.trim();
  if (row.valueType === "string") return row.value;
  if (row.valueType === "number") {
    const value = Number(trimmed);
    if (!trimmed || !Number.isFinite(value)) {
      throw new Error(`配置“${row.key || "未命名"}”必须是有效数字`);
    }
    return value;
  }
  if (row.valueType === "boolean") {
    if (trimmed === "true") return true;
    if (trimmed === "false") return false;
    throw new Error(`配置“${row.key || "未命名"}”必须是 true 或 false`);
  }
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    throw new Error(`配置“${row.key || "未命名"}”必须是有效 JSON`);
  }
}

export function rowsToConfiguration(
  rows: ConfigurationRow[],
): GraphFactoryConfiguration {
  const configuration: GraphFactoryConfiguration = {};
  for (const row of rows) {
    const key = row.key.trim();
    if (!key) throw new Error("Configuration Key 不能为空");
    if (Object.hasOwn(configuration, key)) {
      throw new Error(`Configuration Key 重复：${key}`);
    }
    configuration[key] = rowValue(row);
  }
  return configuration;
}

export function isSensitiveConfigurationKey(key: string): boolean {
  return /(?:password|passwd|secret|token|credential|private[._-]?key)/i.test(key);
}

export function isProtectedConfigurationKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
  return normalized === "graphgraphname" || normalized === "createdusingtemplate";
}

export function isTemplateCreatedConfiguration(
  configuration: GraphFactoryConfiguration,
): boolean {
  const entry = Object.entries(configuration).find(([key]) =>
    key.toLowerCase().replace(/[^a-z0-9]/g, "") === "createdusingtemplate",
  );
  return entry?.[1] === true || String(entry?.[1]).toLowerCase() === "true";
}

export type GraphInstanceSession = {
  id: string;
  current: boolean;
};

export type GraphInstanceSnapshot = {
  available: boolean;
  sessions: GraphInstanceSession[];
};

export function parseGraphInstanceSessions(items: unknown[]): GraphInstanceSession[] {
  const decoded = decodeGraphValue(items);
  const values = Array.isArray(decoded) ? decoded.flat() : [decoded];
  return values.flatMap((value) => {
    const record = recordOf(value);
    const id = typeof record?.id === "string" ? record.id.trim() : "";
    return id ? [{ id, current: record?.current === true }] : [];
  });
}

export function parseGraphInstanceSnapshot(items: unknown[]): GraphInstanceSnapshot | null {
  const decoded = decodeGraphValue(items);
  const values = (Array.isArray(decoded) ? decoded.flat(2) : [decoded]);
  const snapshot = values.map(recordOf).find((value) =>
    value && (Object.hasOwn(value, "available") || Object.hasOwn(value, "sessions")),
  );
  if (!snapshot) return null;
  return {
    available: snapshot.available === true,
    sessions: parseGraphInstanceSessions([snapshot.sessions]),
  };
}

export function duplicateGraphInstanceId(message: string): string | null {
  return message.match(/same instance id\s*\[([^\]\r\n]+)\]\s*is already open/i)?.[1]?.trim() ?? null;
}

export function validateGraphName(value: string): string {
  const name = value.trim();
  if (!name) throw new Error("图名称不能为空");
  if (name.length > 120) throw new Error("图名称不能超过 120 个字符");
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(name)) {
    throw new Error("图名称只能包含字母、数字、点、短横线和下划线");
  }
  return name;
}
