import { decodeGraphValue } from "./result-model";

const FACTORY = "org.janusgraph.core.ConfiguredGraphFactory";
const IO_CORE = "org.apache.tinkerpop.gremlin.structure.io.IoCore";
const MAP_CONFIGURATION = "org.apache.commons.configuration2.MapConfiguration";
const RESOLVE_GRAPH = `def __graph = null
if (graphAccess == "configured") {
  __graph = ${FACTORY}.open(graphName)
} else {
  def __manager = org.janusgraph.core.JanusGraphManagerUtility.getInstance()
  __graph = __manager == null ? null : __manager.getGraph(graphBinding)
  if (__graph == null && this.binding.hasVariable(graphBinding)) { __graph = this.binding.getVariable(graphBinding) }
  if (__graph == null) { throw new IllegalStateException("Connection graph binding was not found: " + graphBinding) }
}`;

export type BatchLoadingSnapshot = {
  hasBatchLoading: boolean;
  batchLoading: boolean;
  hasSchemaDefault: boolean;
  schemaDefault: string;
};

export type ConfiguredGraphTarget = {
  name: string;
  traversalSource: string;
};

export type DeletedVertexBatch = {
  deleted: number;
  complete: boolean;
};

export type VertexCount = {
  total: number;
};

export function graphsonExportFileName(graphName: string, date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${graphName}-${year}${month}${day}.graphson`;
}

export const SERVER_GRAPHSON_QUERIES = {
  listConfiguredGraphs: `return ${FACTORY}.getGraphNames().toList().sort().collect { __name -> [
  name: __name,
  traversalSource: ${FACTORY}.toTraversalSourceName(__name)
] }`,
  exportGraph: `def __path = java.nio.file.Paths.get(serverPath).normalize()
if (!__path.isAbsolute()) { throw new IllegalArgumentException("Server GraphSON path must be absolute") }
def __parent = __path.getParent()
if (__parent == null || !java.nio.file.Files.isDirectory(__parent)) { throw new IllegalArgumentException("Server directory does not exist: " + __parent) }
if (java.nio.file.Files.exists(__path) && !overwrite) { throw new IllegalStateException("SERVER_FILE_EXISTS: " + __path) }
${RESOLVE_GRAPH}
def __temporary = __parent.resolve("." + __path.getFileName().toString() + ".janus-studio-partial-" + java.util.UUID.randomUUID().toString())
try {
  __graph.io(${IO_CORE}.graphson()).writeGraph(__temporary.toString())
  try {
    if (overwrite) {
      java.nio.file.Files.move(__temporary, __path, java.nio.file.StandardCopyOption.REPLACE_EXISTING, java.nio.file.StandardCopyOption.ATOMIC_MOVE)
    } else {
      java.nio.file.Files.move(__temporary, __path, java.nio.file.StandardCopyOption.ATOMIC_MOVE)
    }
  } catch (java.nio.file.AtomicMoveNotSupportedException __ignored) {
    if (overwrite) {
      java.nio.file.Files.move(__temporary, __path, java.nio.file.StandardCopyOption.REPLACE_EXISTING)
    } else {
      java.nio.file.Files.move(__temporary, __path)
    }
  }
} finally {
  java.nio.file.Files.deleteIfExists(__temporary)
}
return [[graphName: graphName, serverPath: __path.toString(), sizeBytes: java.nio.file.Files.size(__path), completed: true]]`,
  importGraph: `def __path = java.nio.file.Paths.get(serverPath).normalize()
if (!__path.isAbsolute()) { throw new IllegalArgumentException("Server GraphSON path must be absolute") }
if (!java.nio.file.Files.isRegularFile(__path) || !java.nio.file.Files.isReadable(__path)) { throw new IllegalArgumentException("Server GraphSON file is not readable: " + __path) }
${RESOLVE_GRAPH}
__graph.io(${IO_CORE}.graphson()).readGraph(__path.toString())
return [[graphName: graphName, serverPath: __path.toString(), completed: true]]`,
  countVertices: `${RESOLVE_GRAPH}
def __g = __graph.traversal()
try {
  return [[graphName: graphName, total: ((Number) __g.V().count().next()).longValue()]]
} finally {
  __g.close()
}`,
  deleteVertexBatch: `${RESOLVE_GRAPH}
def __limit = Math.max(1, Math.min(((Number) batchSize).intValue(), 100))
def __g = __graph.traversal()
try {
  def __ids = __g.V().limit(__limit).id().toList()
  def __deleted = __ids.size()
  if (__deleted > 0) {
    __g.V().hasId(org.apache.tinkerpop.gremlin.process.traversal.P.within(__ids)).drop().iterate()
    if (__graph.features().graph().supportsTransactions()) { __graph.tx().commit() }
  }
  return [[graphName: graphName, deleted: __deleted, complete: __deleted == 0]]
} catch (Throwable __error) {
  if (__graph.features().graph().supportsTransactions()) { __graph.tx().rollback() }
  throw __error
} finally {
  __g.close()
}`,
  batchLoadingStatus: `def __configuration = ${FACTORY}.getConfiguration(graphName)
if (__configuration == null) { throw new IllegalStateException("Dynamic graph configuration was not found: " + graphName) }
return [[
  hasBatchLoading: __configuration.containsKey("storage.batch-loading"),
  batchLoading: __configuration.containsKey("storage.batch-loading") ? Boolean.valueOf(__configuration.get("storage.batch-loading").toString()) : false,
  hasSchemaDefault: __configuration.containsKey("schema.default"),
  schemaDefault: __configuration.containsKey("schema.default") ? __configuration.get("schema.default").toString() : ""
]]`,
  enableBatchLoading: `def __values = new LinkedHashMap()
__values.put("storage.batch-loading", true)
if (disableAutomaticSchema) { __values.put("schema.default", "none") }
${FACTORY}.updateConfiguration(graphName, new ${MAP_CONFIGURATION}(__values))
def __graph = ${FACTORY}.open(graphName)
if (__graph == null || !__graph.isOpen()) { throw new IllegalStateException("Graph could not be reopened with batch loading: " + graphName) }
return [[graphName: graphName, batchLoading: true, schemaDefault: disableAutomaticSchema ? "none" : null]]`,
  restoreBatchLoading: `def __removedKeys = new LinkedHashSet()
def __values = new LinkedHashMap()
if (hasBatchLoading) { __values.put("storage.batch-loading", batchLoading) } else { __removedKeys.add("storage.batch-loading") }
if (hasSchemaDefault) { __values.put("schema.default", schemaDefault) } else { __removedKeys.add("schema.default") }
if (!__removedKeys.isEmpty()) { ${FACTORY}.removeConfiguration(graphName, __removedKeys) }
if (!__values.isEmpty()) { ${FACTORY}.updateConfiguration(graphName, new ${MAP_CONFIGURATION}(__values)) }
def __graph = ${FACTORY}.open(graphName)
if (__graph == null || !__graph.isOpen()) { throw new IllegalStateException("Graph could not be reopened after restoring batch loading: " + graphName) }
return [[graphName: graphName, restored: true]]`,
} as const;

function record(value: unknown): Record<string, unknown> | null {
  const decoded = decodeGraphValue(value);
  return decoded && typeof decoded === "object" && !Array.isArray(decoded)
    ? decoded as Record<string, unknown>
    : null;
}

export function parseConfiguredGraphTargets(items: unknown[]): ConfiguredGraphTarget[] {
  const values = items.flatMap((item) => {
    const decoded = decodeGraphValue(item);
    return Array.isArray(decoded) ? decoded : [decoded];
  });
  return values.flatMap((value) => {
    const row = record(value);
    if (!row || typeof row.name !== "string" || !row.name.trim()) return [];
    const name = row.name.trim();
    return [{
      name,
      traversalSource: typeof row.traversalSource === "string" && row.traversalSource.trim()
        ? row.traversalSource.trim()
        : `${name}_traversal`,
    }];
  });
}

export function parseBatchLoadingSnapshot(items: unknown[]): BatchLoadingSnapshot | null {
  const value = items.map(record).find(Boolean);
  if (!value) return null;
  return {
    hasBatchLoading: value.hasBatchLoading === true,
    batchLoading: value.batchLoading === true,
    hasSchemaDefault: value.hasSchemaDefault === true,
    schemaDefault: typeof value.schemaDefault === "string" ? value.schemaDefault : "",
  };
}

export function parseDeletedVertexBatch(items: unknown[]): DeletedVertexBatch | null {
  const value = items.map(record).find(Boolean);
  if (!value) return null;
  const deleted = Number(value.deleted);
  if (!Number.isSafeInteger(deleted) || deleted < 0) return null;
  return { deleted, complete: value.complete === true || deleted === 0 };
}

export function parseVertexCount(items: unknown[]): VertexCount | null {
  const value = items.map(record).find(Boolean);
  if (!value) return null;
  const total = Number(value.total);
  return Number.isSafeInteger(total) && total >= 0 ? { total } : null;
}
