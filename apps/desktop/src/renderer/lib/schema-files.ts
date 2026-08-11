import type { PickedSchemaFile } from "@janusgraph/domain";
import { schemaRowsFromItems } from "./gremlin-completion";
import { safeIdentifier, stringLiteral } from "./gremlin-identifiers";

export type SchemaPropertyKey = {
  name: string;
  dataType: string;
  cardinality: "SINGLE" | "LIST" | "SET";
};

export type SchemaVertexLabel = {
  name: string;
  partitioned: boolean;
  static: boolean;
};

export type SchemaEdgeLabel = {
  name: string;
  multiplicity: "MULTI" | "SIMPLE" | "ONE2MANY" | "MANY2ONE" | "ONE2ONE";
};

export type SchemaGraphIndex = {
  name: string;
  element: "Vertex" | "Edge";
  type: "COMPOSITE" | "MIXED";
  unique: boolean;
  backingIndex?: string;
  fields: string[];
};

export type SchemaArchive = {
  format: "janus-studio.schema/v1";
  exportedAt: string;
  source: {
    connectionName: string;
    graphBinding: string;
    traversalSource: string;
  };
  schema: {
    propertyKeys: SchemaPropertyKey[];
    vertexLabels: SchemaVertexLabel[];
    edgeLabels: SchemaEdgeLabel[];
    graphIndexes: SchemaGraphIndex[];
  };
};

export type SchemaImportOperation = {
  group: keyof SchemaArchive["schema"];
  name: string;
  summary: string;
};

export type SchemaImportConflict = {
  key: string;
  reason: string;
};

export type SchemaImportPlan = {
  operations: SchemaImportOperation[];
  indexActivations: string[];
  skipped: string[];
  conflicts: SchemaImportConflict[];
  script: string | null;
  scripts: string[];
};

export function formatSchemaArchiveTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.replace("T", " ").replace(/Z$/, "");
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

const CARDINALITIES = new Set(["SINGLE", "LIST", "SET"]);
const MULTIPLICITIES = new Set([
  "MULTI",
  "SIMPLE",
  "ONE2MANY",
  "MANY2ONE",
  "ONE2ONE",
]);
const DATA_TYPE_EXPRESSIONS: Record<string, string> = {
  String: "String.class",
  Character: "Character.class",
  Boolean: "Boolean.class",
  Byte: "Byte.class",
  Short: "Short.class",
  Integer: "Integer.class",
  Long: "Long.class",
  Float: "Float.class",
  Double: "Double.class",
  Date: "Date.class",
  UUID: "java.util.UUID.class",
  Geoshape: "org.janusgraph.core.attribute.Geoshape.class",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requiredString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${path} 必须是非空字符串`);
  }
  if (value.length > 255) throw new Error(`${path} 不能超过 255 个字符`);
  return value;
}

function booleanValue(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function stringArray(value: unknown, path: string): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${path} 必须至少包含一个 Property Key`);
  }
  const values = value.map((item, index) => requiredString(item, `${path}[${index}]`));
  if (new Set(values).size !== values.length) throw new Error(`${path} 包含重复字段`);
  return [...values].sort();
}

function assertUniqueNames(values: Array<{ name: string }>, path: string): void {
  const names = new Set<string>();
  for (const value of values) {
    if (names.has(value.name)) throw new Error(`${path} 包含重复定义：${value.name}`);
    names.add(value.name);
  }
}

function propertyKeyFrom(value: unknown, path: string, validateDataType = true): SchemaPropertyKey {
  if (!isRecord(value)) throw new Error(`${path} 必须是对象`);
  const dataType = requiredString(value.dataType, `${path}.dataType`);
  const cardinality = requiredString(value.cardinality, `${path}.cardinality`).toUpperCase();
  if (validateDataType && !DATA_TYPE_EXPRESSIONS[dataType]) throw new Error(`${path}.dataType 不受支持：${dataType}`);
  if (!CARDINALITIES.has(cardinality)) throw new Error(`${path}.cardinality 无效：${cardinality}`);
  return {
    name: requiredString(value.name, `${path}.name`),
    dataType,
    cardinality: cardinality as SchemaPropertyKey["cardinality"],
  };
}

function vertexLabelFrom(value: unknown, path: string): SchemaVertexLabel {
  if (!isRecord(value)) throw new Error(`${path} 必须是对象`);
  return {
    name: requiredString(value.name, `${path}.name`),
    partitioned: booleanValue(value.partitioned),
    static: booleanValue(value.static),
  };
}

function edgeLabelFrom(value: unknown, path: string): SchemaEdgeLabel {
  if (!isRecord(value)) throw new Error(`${path} 必须是对象`);
  const multiplicity = requiredString(value.multiplicity, `${path}.multiplicity`).toUpperCase();
  if (!MULTIPLICITIES.has(multiplicity)) throw new Error(`${path}.multiplicity 无效：${multiplicity}`);
  return {
    name: requiredString(value.name, `${path}.name`),
    multiplicity: multiplicity as SchemaEdgeLabel["multiplicity"],
  };
}

function graphIndexFrom(value: unknown, path: string): SchemaGraphIndex {
  if (!isRecord(value)) throw new Error(`${path} 必须是对象`);
  const element = requiredString(value.element, `${path}.element`);
  const type = requiredString(value.type, `${path}.type`).toUpperCase();
  if (element !== "Vertex" && element !== "Edge") throw new Error(`${path}.element 无效：${element}`);
  if (type !== "COMPOSITE" && type !== "MIXED") throw new Error(`${path}.type 无效：${type}`);
  const backingIndex = typeof value.backingIndex === "string" ? value.backingIndex.trim() : "";
  if (type === "MIXED" && !backingIndex) throw new Error(`${path}.backingIndex 不能为空`);
  return {
    name: requiredString(value.name, `${path}.name`),
    element,
    type,
    unique: type === "COMPOSITE" && booleanValue(value.unique),
    ...(type === "MIXED" ? { backingIndex } : {}),
    fields: stringArray(value.fields, `${path}.fields`),
  };
}

function rowsToSchema(items: unknown[]): SchemaArchive["schema"] {
  const schema: SchemaArchive["schema"] = {
    propertyKeys: [],
    vertexLabels: [],
    edgeLabels: [],
    graphIndexes: [],
  };
  for (const row of schemaRowsFromItems(items)) {
    if (row.group === "propertyKeys") schema.propertyKeys.push(propertyKeyFrom(row, `Property Key ${String(row.name ?? "")}`, false));
    if (row.group === "vertexLabels") schema.vertexLabels.push(vertexLabelFrom(row, `Vertex Label ${String(row.name ?? "")}`));
    if (row.group === "edgeLabels") schema.edgeLabels.push(edgeLabelFrom(row, `Edge Label ${String(row.name ?? "")}`));
    if (row.group === "graphIndexes") schema.graphIndexes.push(graphIndexFrom(row, `Graph Index ${String(row.name ?? "")}`));
  }
  for (const values of Object.values(schema)) values.sort((left, right) => left.name.localeCompare(right.name));
  return schema;
}

export function createSchemaArchive(
  items: unknown[],
  source: SchemaArchive["source"],
  exportedAt = new Date().toISOString(),
): SchemaArchive {
  return {
    format: "janus-studio.schema/v1",
    exportedAt,
    source,
    schema: rowsToSchema(items),
  };
}

export function parseSchemaArchive(file: PickedSchemaFile): SchemaArchive {
  let decoded: unknown;
  try {
    decoded = JSON.parse(file.content);
  } catch {
    throw new Error("Schema 文件不是有效的 JSON");
  }
  if (!isRecord(decoded) || decoded.format !== "janus-studio.schema/v1") {
    throw new Error("文件不是有效的 Janus Studio Schema v1 归档");
  }
  if (!isRecord(decoded.source) || !isRecord(decoded.schema)) {
    throw new Error("Schema 归档缺少 source 或 schema");
  }
  const source = decoded.source;
  const schemaValue = decoded.schema;
  const readList = <T>(key: keyof SchemaArchive["schema"], parser: (value: unknown, path: string) => T): T[] => {
    const value = schemaValue[key];
    if (!Array.isArray(value)) throw new Error(`schema.${key} 必须是数组`);
    return value.map((item, index) => parser(item, `schema.${key}[${index}]`));
  };
  const schema: SchemaArchive["schema"] = {
    propertyKeys: readList("propertyKeys", propertyKeyFrom),
    vertexLabels: readList("vertexLabels", vertexLabelFrom),
    edgeLabels: readList("edgeLabels", edgeLabelFrom),
    graphIndexes: readList("graphIndexes", graphIndexFrom),
  };
  for (const [key, values] of Object.entries(schema)) assertUniqueNames(values, `schema.${key}`);
  return {
    format: "janus-studio.schema/v1",
    exportedAt: requiredString(decoded.exportedAt, "exportedAt"),
    source: {
      connectionName: requiredString(source.connectionName, "source.connectionName"),
      graphBinding: requiredString(source.graphBinding, "source.graphBinding"),
      traversalSource: requiredString(source.traversalSource, "source.traversalSource"),
    },
    schema,
  };
}

function sameDefinition(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function operation(group: SchemaImportOperation["group"], value: { name: string }): SchemaImportOperation {
  const labels: Record<SchemaImportOperation["group"], string> = {
    propertyKeys: "Property Key",
    vertexLabels: "Vertex Label",
    edgeLabels: "Edge Label",
    graphIndexes: "Graph Index",
  };
  return { group, name: value.name, summary: `${labels[group]} · ${value.name}` };
}

function buildImportScript(
  archive: SchemaArchive,
  operations: SchemaImportOperation[],
  graphBinding: string,
  traversalSource: string,
): string | null {
  if (operations.length === 0) return null;
  const wanted = new Set(operations.map((item) => `${item.group}:${item.name}`));
  const graphBindingName = stringLiteral(safeIdentifier(graphBinding));
  const traversalSourceName = stringLiteral(safeIdentifier(traversalSource));
  const lines = [
    "def __binding = this.getBinding()",
    `def __graph = __binding.hasVariable(${graphBindingName}) ? __binding.getVariable(${graphBindingName}) : null`,
    `def __source = __binding.hasVariable(${traversalSourceName}) ? __binding.getVariable(${traversalSourceName}) : (__binding.hasVariable("g") ? __binding.getVariable("g") : null)`,
    "if (__graph == null && __source != null) {",
    "  def __optionalGraph = __source.getGraph()",
    "  __graph = __optionalGraph.isPresent() ? __optionalGraph.get() : null",
    "}",
    'if (__graph == null) { throw new IllegalStateException("Target JanusGraph graph binding is unavailable") }',
    "def mgmt = __graph.openManagement()",
    "try {",
  ];
  archive.schema.propertyKeys.forEach((value, index) => {
    if (!wanted.has(`propertyKeys:${value.name}`)) return;
    lines.push(`  def existingPropertyKey${index} = mgmt.getPropertyKey(${stringLiteral(value.name)})`);
    lines.push(`  if (existingPropertyKey${index} == null) {`);
    lines.push(`    mgmt.makePropertyKey(${stringLiteral(value.name)}).dataType(${DATA_TYPE_EXPRESSIONS[value.dataType]}).cardinality(org.janusgraph.core.Cardinality.${value.cardinality}).make()`);
    lines.push(`  } else if (existingPropertyKey${index}.dataType() != ${DATA_TYPE_EXPRESSIONS[value.dataType]} || existingPropertyKey${index}.cardinality() != org.janusgraph.core.Cardinality.${value.cardinality}) {`);
    lines.push(`    throw new IllegalStateException(${stringLiteral(`Schema definition conflict: Property Key ${value.name}`)})`);
    lines.push("  }");
  });
  archive.schema.vertexLabels.forEach((value, index) => {
    if (!wanted.has(`vertexLabels:${value.name}`)) return;
    lines.push(`  def existingVertexLabel${index} = mgmt.getVertexLabel(${stringLiteral(value.name)})`);
    lines.push(`  if (existingVertexLabel${index} == null) {`);
    lines.push(`    def vertexLabel${index} = mgmt.makeVertexLabel(${stringLiteral(value.name)})`);
    if (value.partitioned) lines.push(`    vertexLabel${index}.partition()`);
    if (value.static) lines.push(`    vertexLabel${index}.setStatic()`);
    lines.push(`    vertexLabel${index}.make()`);
    lines.push(`  } else if (existingVertexLabel${index}.isPartitioned() != ${value.partitioned} || existingVertexLabel${index}.isStatic() != ${value.static}) {`);
    lines.push(`    throw new IllegalStateException(${stringLiteral(`Schema definition conflict: Vertex Label ${value.name}`)})`);
    lines.push("  }");
  });
  archive.schema.edgeLabels.forEach((value, index) => {
    if (!wanted.has(`edgeLabels:${value.name}`)) return;
    lines.push(`  def existingEdgeLabel${index} = mgmt.getEdgeLabel(${stringLiteral(value.name)})`);
    lines.push(`  if (existingEdgeLabel${index} == null) {`);
    lines.push(`    mgmt.makeEdgeLabel(${stringLiteral(value.name)}).multiplicity(org.janusgraph.core.Multiplicity.${value.multiplicity}).make()`);
    lines.push(`  } else if (existingEdgeLabel${index}.multiplicity() != org.janusgraph.core.Multiplicity.${value.multiplicity}) {`);
    lines.push(`    throw new IllegalStateException(${stringLiteral(`Schema definition conflict: Edge Label ${value.name}`)})`);
    lines.push("  }");
  });
  archive.schema.graphIndexes.forEach((value, index) => {
    if (!wanted.has(`graphIndexes:${value.name}`)) return;
    lines.push(`  def existingGraphIndex${index} = mgmt.getGraphIndex(${stringLiteral(value.name)})`);
    lines.push(`  if (existingGraphIndex${index} == null) {`);
    lines.push(`    def indexBuilder${index} = mgmt.buildIndex(${stringLiteral(value.name)}, org.apache.tinkerpop.gremlin.structure.${value.element}.class)`);
    value.fields.forEach((field, fieldIndex) => {
      lines.push(`    def indexKey${index}_${fieldIndex} = mgmt.getPropertyKey(${stringLiteral(field)})`);
      lines.push(`    if (indexKey${index}_${fieldIndex} == null) { throw new IllegalArgumentException(${stringLiteral(`PropertyKey not found: ${field}`)}) }`);
      lines.push(`    indexBuilder${index}.addKey(indexKey${index}_${fieldIndex})`);
    });
    if (value.type === "MIXED") {
      lines.push(`    indexBuilder${index}.buildMixedIndex(${stringLiteral(value.backingIndex ?? "search")})`);
    } else {
      if (value.unique) lines.push(`    indexBuilder${index}.unique()`);
      lines.push(`    indexBuilder${index}.buildCompositeIndex()`);
    }
    const expectedFields = `[${value.fields.map(stringLiteral).join(", ")}] as Set`;
    const expectedTypeCheck = value.type === "MIXED"
      ? `!existingGraphIndex${index}.isMixedIndex() || existingGraphIndex${index}.getBackingIndex() != ${stringLiteral(value.backingIndex ?? "search")}`
      : `!existingGraphIndex${index}.isCompositeIndex() || existingGraphIndex${index}.isUnique() != ${value.unique}`;
    lines.push("  } else {");
    lines.push(`    def existingIndexFields${index} = existingGraphIndex${index}.getFieldKeys().collect { __key -> __key.name() }.toSet()`);
    lines.push(`    if (existingGraphIndex${index}.getIndexedElement() != org.apache.tinkerpop.gremlin.structure.${value.element}.class || ${expectedTypeCheck} || existingIndexFields${index} != (${expectedFields})) {`);
    lines.push(`      throw new IllegalStateException(${stringLiteral(`Schema definition conflict: Graph Index ${value.name}`)})`);
    lines.push("    }");
    lines.push("  }");
  });
  lines.push(
    "  mgmt.commit()",
    "} catch (Throwable error) {",
    "  if (mgmt != null && mgmt.isOpen()) { mgmt.rollback() }",
    "  throw error",
    "}",
    "def verifyMgmt = __graph.openManagement()",
    "try {",
    "  def missing = []",
  );
  archive.schema.propertyKeys.forEach((value) => {
    if (!wanted.has(`propertyKeys:${value.name}`)) return;
    lines.push(`  if (verifyMgmt.getPropertyKey(${stringLiteral(value.name)}) == null) { missing << ${stringLiteral(`Property Key: ${value.name}`)} }`);
  });
  archive.schema.vertexLabels.forEach((value) => {
    if (!wanted.has(`vertexLabels:${value.name}`)) return;
    lines.push(`  if (verifyMgmt.getVertexLabel(${stringLiteral(value.name)}) == null) { missing << ${stringLiteral(`Vertex Label: ${value.name}`)} }`);
  });
  archive.schema.edgeLabels.forEach((value) => {
    if (!wanted.has(`edgeLabels:${value.name}`)) return;
    lines.push(`  if (verifyMgmt.getEdgeLabel(${stringLiteral(value.name)}) == null) { missing << ${stringLiteral(`Edge Label: ${value.name}`)} }`);
  });
  archive.schema.graphIndexes.forEach((value) => {
    if (!wanted.has(`graphIndexes:${value.name}`)) return;
    lines.push(`  if (verifyMgmt.getGraphIndex(${stringLiteral(value.name)}) == null) { missing << ${stringLiteral(`Graph Index: ${value.name}`)} }`);
  });
  lines.push(
    '  if (!missing.isEmpty()) { throw new IllegalStateException("Schema import verification failed; definitions not found: " + missing.join(", ")) }',
    `  return [created: ${operations.length}, verified: ${operations.length}]`,
    "} finally {",
    "  if (verifyMgmt != null && verifyMgmt.isOpen()) { verifyMgmt.rollback() }",
    "}",
  );
  return lines.join("\n");
}

const SCHEMA_IMPORT_BATCH_SIZE = 25;

function buildImportScripts(
  archive: SchemaArchive,
  operations: SchemaImportOperation[],
  indexActivations: string[],
  graphBinding: string,
  traversalSource: string,
): string[] {
  const groups: SchemaImportOperation["group"][] = [
    "propertyKeys",
    "vertexLabels",
    "edgeLabels",
    "graphIndexes",
  ];
  const definitionScripts = groups.flatMap((group) => {
    const values = operations.filter((operation) => operation.group === group);
    const scripts: string[] = [];
    for (let offset = 0; offset < values.length; offset += SCHEMA_IMPORT_BATCH_SIZE) {
      const script = buildImportScript(
        archive,
        values.slice(offset, offset + SCHEMA_IMPORT_BATCH_SIZE),
        graphBinding,
        traversalSource,
      );
      if (script) scripts.push(script);
    }
    return scripts;
  });
  const lifecycleScripts: string[] = [];
  for (let offset = 0; offset < indexActivations.length; offset += SCHEMA_IMPORT_BATCH_SIZE) {
    const names = indexActivations.slice(offset, offset + SCHEMA_IMPORT_BATCH_SIZE);
    lifecycleScripts.push(
      buildIndexLifecycleScript(names, "REGISTER_INDEX", graphBinding, traversalSource),
      buildAwaitIndexStatusScript(names, "REGISTERED", graphBinding, traversalSource),
      buildIndexLifecycleScript(names, "REINDEX", graphBinding, traversalSource),
      buildAwaitIndexStatusScript(names, "ENABLED", graphBinding, traversalSource),
    );
  }
  return [...definitionScripts, ...lifecycleScripts];
}

function buildIndexLifecycleScript(
  indexNames: string[],
  action: "REGISTER_INDEX" | "REINDEX",
  graphBinding: string,
  traversalSource: string,
): string {
  const graphBindingName = stringLiteral(safeIdentifier(graphBinding));
  const traversalSourceName = stringLiteral(safeIdentifier(traversalSource));
  const names = `[${indexNames.map(stringLiteral).join(", ")}]`;
  const accepted = action === "REGISTER_INDEX" ? '["REGISTERED", "ENABLED"]' : '["ENABLED"]';
  const eligible = action === "REGISTER_INDEX" ? '["INSTALLED", "REGISTERED", "ENABLED"]' : '["REGISTERED", "ENABLED"]';
  return `def __binding = this.getBinding()
def __graph = __binding.hasVariable(${graphBindingName}) ? __binding.getVariable(${graphBindingName}) : null
def __source = __binding.hasVariable(${traversalSourceName}) ? __binding.getVariable(${traversalSourceName}) : (__binding.hasVariable("g") ? __binding.getVariable("g") : null)
if (__graph == null && __source != null) {
  def __optionalGraph = __source.getGraph()
  __graph = __optionalGraph.isPresent() ? __optionalGraph.get() : null
}
if (__graph == null) { throw new IllegalStateException("Target JanusGraph graph binding is unavailable") }
def __names = ${names}
def mgmt = __graph.openManagement()
def futures = []
try {
  __names.each { __name ->
    def __index = mgmt.getGraphIndex(__name)
    if (__index == null) { throw new IllegalStateException("Graph Index not found: " + __name) }
    def __statuses = __index.getFieldKeys().collect { __key -> __index.getIndexStatus(__key).name() }.toSet()
    if (!__statuses.every { __status -> ${eligible}.contains(__status) }) {
      throw new IllegalStateException("Graph Index " + __name + " cannot run ${action} from status " + __statuses)
    }
    if (!__statuses.every { __status -> ${accepted}.contains(__status) }) {
      futures << mgmt.updateIndex(__index, org.janusgraph.core.schema.SchemaAction.${action})
    }
  }
  mgmt.commit()
} catch (Throwable error) {
  if (mgmt != null && mgmt.isOpen()) { mgmt.rollback() }
  throw error
}
futures.each { __future -> __future.get() }
return [action: "${action}", indexes: __names, submitted: futures.size()]`;
}

function buildAwaitIndexStatusScript(
  indexNames: string[],
  target: "REGISTERED" | "ENABLED",
  graphBinding: string,
  traversalSource: string,
): string {
  const graphBindingName = stringLiteral(safeIdentifier(graphBinding));
  const traversalSourceName = stringLiteral(safeIdentifier(traversalSource));
  const names = `[${indexNames.map(stringLiteral).join(", ")}]`;
  const targets = target === "REGISTERED"
    ? "org.janusgraph.core.schema.SchemaStatus.REGISTERED, org.janusgraph.core.schema.SchemaStatus.ENABLED"
    : "org.janusgraph.core.schema.SchemaStatus.ENABLED";
  return `def __binding = this.getBinding()
def __graph = __binding.hasVariable(${graphBindingName}) ? __binding.getVariable(${graphBindingName}) : null
def __source = __binding.hasVariable(${traversalSourceName}) ? __binding.getVariable(${traversalSourceName}) : (__binding.hasVariable("g") ? __binding.getVariable("g") : null)
if (__graph == null && __source != null) {
  def __optionalGraph = __source.getGraph()
  __graph = __optionalGraph.isPresent() ? __optionalGraph.get() : null
}
if (__graph == null) { throw new IllegalStateException("Target JanusGraph graph binding is unavailable") }
def __names = ${names}
__names.each { __name ->
  def __watcher = org.janusgraph.graphdb.database.management.ManagementSystem.awaitGraphIndexStatus(__graph, __name)
  __watcher.status(${targets})
  __watcher.timeout(45, java.time.temporal.ChronoUnit.SECONDS)
  __watcher.pollInterval(1, java.time.temporal.ChronoUnit.SECONDS)
  def __report = __watcher.call()
  if (!__report.getSucceeded()) {
    throw new IllegalStateException("Index status timeout: " + __name + " did not reach ${target}; not converged=" + __report.getNotConvergedKeys())
  }
}
return [[status: "${target}", indexes: __names, verified: true]]`;
}

function indexStatuses(row: Record<string, unknown> | undefined): string[] {
  if (!row) return [];
  const fieldStatus = isRecord(row.fieldStatus) ? Object.values(row.fieldStatus) : [];
  const values = fieldStatus.length > 0 ? fieldStatus : String(row.status ?? "").split(",");
  return [...new Set(values.map((value) => String(value).trim().toUpperCase()).filter(Boolean))];
}

export function planSchemaImport(
  archive: SchemaArchive,
  currentItems: unknown[],
  graphBinding: string,
  traversalSource = "g",
): SchemaImportPlan {
  const current = rowsToSchema(currentItems);
  const operations: SchemaImportOperation[] = [];
  const indexActivations: string[] = [];
  const skipped: string[] = [];
  const conflicts: SchemaImportConflict[] = [];
  const groups = Object.keys(archive.schema) as Array<keyof SchemaArchive["schema"]>;
  const currentIndexRows = new Map(
    schemaRowsFromItems(currentItems)
      .filter((row) => row.group === "graphIndexes")
      .map((row) => [String(row.name), row]),
  );

  for (const group of groups) {
    const existing = new Map(current[group].map((value) => [value.name, value]));
    for (const value of archive.schema[group]) {
      const key = `${group}:${value.name}`;
      const found = existing.get(value.name);
      if (!found) {
        operations.push(operation(group, value));
        if (group === "graphIndexes") indexActivations.push(value.name);
      } else if (sameDefinition(found, value)) {
        if (group !== "graphIndexes") skipped.push(key);
        else {
          const statuses = indexStatuses(currentIndexRows.get(value.name));
          if (statuses.length > 0 && statuses.every((status) => status === "ENABLED")) skipped.push(key);
          else if (statuses.length > 0 && statuses.every((status) => status === "INSTALLED" || status === "REGISTERED" || status === "ENABLED")) indexActivations.push(value.name);
          else conflicts.push({ key, reason: `目标索引状态无法自动启用：${statuses.join(", ") || "UNKNOWN"}` });
        }
      }
      else conflicts.push({ key, reason: "目标图中存在同名但定义不同的 Schema" });
    }
  }

  const availableProperties = new Set([
    ...current.propertyKeys.map((value) => value.name),
    ...archive.schema.propertyKeys.map((value) => value.name),
  ]);
  for (const index of archive.schema.graphIndexes) {
    for (const field of index.fields) {
      if (!availableProperties.has(field)) {
        conflicts.push({
          key: `graphIndexes:${index.name}`,
          reason: `索引依赖未定义的 Property Key：${field}`,
        });
      }
    }
  }

  const uniqueConflicts = [...new Map(conflicts.map((item) => [`${item.key}:${item.reason}`, item])).values()];
  const scripts = uniqueConflicts.length === 0
    ? buildImportScripts(archive, operations, indexActivations, graphBinding, traversalSource)
    : [];
  return {
    operations,
    indexActivations,
    skipped,
    conflicts: uniqueConflicts,
    script: scripts.length > 0
      ? scripts.map((script, index) => `// Schema import batch ${index + 1}/${scripts.length}\n${script}`).join("\n\n")
      : null,
    scripts,
  };
}
