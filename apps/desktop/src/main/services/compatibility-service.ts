import type {
  CompatibilityCapability,
  CompatibilityCapabilityState,
  CompatibilityProfile,
  ConnectionProfile,
} from "@janusgraph/domain";
import { randomUUID } from "node:crypto";
import { ConnectionService } from "./connection-service";
import { QueryService } from "./query-service";

export const COMPATIBILITY_PROBE_QUERY = `def __available = { __name ->
  try {
    Class.forName(__name, false, Thread.currentThread().getContextClassLoader())
    return true
  } catch (Throwable __ignored) {
    return false
  }
}
def __cleanVersion = { __value ->
  if (__value == null) return null
  def __text = __value.toString().trim()
  if (__text.length() == 0 || __text.equalsIgnoreCase("unknown") || __text.equalsIgnoreCase("null") || __text.contains('$' + '{')) return null
  return __text
}
def __manifestVersion = { __attribute ->
  try {
    def __manifests = Class.forName("com.jcabi.manifests.Manifests", false, Thread.currentThread().getContextClassLoader())
    if (!__manifests.exists(__attribute)) return null
    return __cleanVersion(__manifests.read(__attribute))
  } catch (Throwable __ignored) {
    return null
  }
}
def __packageVersion = { __type ->
  try {
    return __cleanVersion(__type.getPackage()?.getImplementationVersion())
  } catch (Throwable __ignored) {
    return null
  }
}
def __mavenVersion = { __type, __group, __artifact ->
  def __stream = null
  try {
    def __resource = "META-INF/maven/" + __group + "/" + __artifact + "/pom.properties"
    def __loader = __type.getClassLoader()
    if (__loader != null) __stream = __loader.getResourceAsStream(__resource)
    if (__stream == null) __stream = Thread.currentThread().getContextClassLoader()?.getResourceAsStream(__resource)
    if (__stream == null) return null
    def __properties = new java.util.Properties()
    __properties.load(__stream)
    return __cleanVersion(__properties.getProperty("version"))
  } catch (Throwable __ignored) {
    return null
  } finally {
    if (__stream != null) {
      try { __stream.close() } catch (Throwable __ignoredClose) {}
    }
  }
}
def __jarVersion = { __type, __artifact ->
  try {
    def __location = __type.getProtectionDomain()?.getCodeSource()?.getLocation()?.toString()
    if (__location == null) return null
    def __pattern = java.util.regex.Pattern.compile('(?:^|/)' + java.util.regex.Pattern.quote(__artifact) + '-([0-9][^/]*)\\\\.jar(?:$|[!?])')
    def __matcher = __pattern.matcher(__location)
    return __matcher.find() ? __cleanVersion(__matcher.group(1)) : null
  } catch (Throwable __ignored) {
    return null
  }
}
def __version = { __name, __manifestAttribute, __group, __artifact ->
  try {
    def __type = Class.forName(__name, false, Thread.currentThread().getContextClassLoader())
    def __value = __manifestVersion(__manifestAttribute)
    if (__value == null) __value = __packageVersion(__type)
    if (__value == null) __value = __mavenVersion(__type, __group, __artifact)
    if (__value == null) __value = __jarVersion(__type, __artifact)
    return __value == null ? "unknown" : __value
  } catch (Throwable __ignored) {
    return "unknown"
  }
}
return [[
  janusGraphVersion: __version("org.janusgraph.core.JanusGraph", "janusgraphVersion", "org.janusgraph", "janusgraph-core"),
  tinkerPopVersion: __version("org.apache.tinkerpop.gremlin.structure.Graph", "tinkerpopVersion", "org.apache.tinkerpop", "gremlin-core"),
  managementApi: __available("org.janusgraph.core.schema.JanusGraphManagement"),
  configuredGraphFactory: __available("org.janusgraph.core.ConfiguredGraphFactory"),
  configurationManagementGraph: __available("org.janusgraph.graphdb.management.ConfigurationManagementGraph"),
  janusGraphManager: __available("org.janusgraph.graphdb.management.JanusGraphManager"),
  jsonSchemaInitialization: __available("org.janusgraph.core.schema.json.definition.JsonSchemaDefinition"),
  graphsonIo: __available("org.apache.tinkerpop.gremlin.structure.io.IoCore")
]]`;

type ProbeRecord = Record<string, unknown>;

function graphsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(graphsonValue);
  if (!value || typeof value !== "object") return value;
  const record = value as ProbeRecord;
  if (record["@type"] === "g:Map" && Array.isArray(record["@value"])) {
    const entries = record["@value"] as unknown[];
    const result: ProbeRecord = {};
    for (let index = 0; index + 1 < entries.length; index += 2) {
      result[String(graphsonValue(entries[index]))] = graphsonValue(entries[index + 1]);
    }
    return result;
  }
  if (record["@value"] !== undefined && typeof record["@type"] === "string") {
    return graphsonValue(record["@value"]);
  }
  return Object.fromEntries(Object.entries(record).map(([key, entry]) => [key, graphsonValue(entry)]));
}

export function parseCompatibilityProbe(items: unknown[]): ProbeRecord | null {
  let value: unknown = graphsonValue(items);
  while (Array.isArray(value) && value.length === 1) value = value[0];
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as ProbeRecord
    : null;
}

const probedCapabilities: CompatibilityCapability[] = [
  "managementApi",
  "configuredGraphFactory",
  "configurationManagementGraph",
  "janusGraphManager",
  "jsonSchemaInitialization",
  "graphsonIo",
];

function connectionSignature(profile: ConnectionProfile): string {
  return [
    profile.updatedAt,
    profile.protocol,
    profile.host,
    profile.port,
    profile.path,
    profile.clientMode,
    profile.traversalSource,
    profile.graphBinding,
  ].join("|");
}

function capabilityState(value: unknown): CompatibilityCapabilityState {
  return value === true ? "supported" : value === false ? "unsupported" : "unknown";
}

export class CompatibilityService {
  private readonly cache = new Map<string, CompatibilityProfile>();

  constructor(
    private readonly connections: ConnectionService,
    private readonly queries: QueryService,
  ) {}

  async get(connectionId: string, refresh = false): Promise<CompatibilityProfile> {
    const profile = this.connections.profile(connectionId);
    const signature = connectionSignature(profile);
    const cached = this.cache.get(connectionId);
    if (!refresh && cached?.connectionSignature === signature) return cached;

    const transportCapabilities = {
      sessionedClient: profile.protocol === "ws" || profile.protocol === "wss"
        ? "supported" as const
        : "unsupported" as const,
      requestTimeout: "supported" as const,
      serverCancellation: profile.protocol === "ws" || profile.protocol === "wss"
        ? "supported" as const
        : "unsupported" as const,
    };
    try {
      const response = await this.queries.execute({
        connectionId,
        consoleId: `compatibility-${connectionId}`,
        executionId: randomUUID(),
        query: COMPATIBILITY_PROBE_QUERY,
        bindings: {},
        recordHistory: false,
      });
      const value = parseCompatibilityProbe(response.items);
      if (!value) throw new Error("Server returned an unrecognized capability probe response");
      const capabilities = Object.fromEntries([
        ...Object.entries(transportCapabilities),
        ...probedCapabilities.map((capability) => [capability, capabilityState(value[capability])]),
      ]) as CompatibilityProfile["capabilities"];
      const unknownCount = Object.values(capabilities).filter((state) => state === "unknown").length;
      const result: CompatibilityProfile = {
        connectionId,
        connectionSignature: signature,
        status: unknownCount > 0 ? "partial" : "ready",
        janusGraphVersion: typeof value.janusGraphVersion === "string" ? value.janusGraphVersion : "unknown",
        tinkerPopVersion: typeof value.tinkerPopVersion === "string" ? value.tinkerPopVersion : "unknown",
        capabilities,
        detectedAt: new Date().toISOString(),
        message: unknownCount > 0 ? `${unknownCount} capabilities could not be determined` : "",
      };
      this.cache.set(connectionId, result);
      return result;
    } catch (error) {
      const unknown = Object.fromEntries(
        probedCapabilities.map((capability) => [capability, "unknown"]),
      ) as Record<CompatibilityCapability, CompatibilityCapabilityState>;
      const result: CompatibilityProfile = {
        connectionId,
        connectionSignature: signature,
        status: "unavailable",
        janusGraphVersion: "unknown",
        tinkerPopVersion: "unknown",
        capabilities: { ...unknown, ...transportCapabilities },
        detectedAt: new Date().toISOString(),
        message: error instanceof Error ? error.message : "Capability probe failed",
      };
      this.cache.set(connectionId, result);
      return result;
    } finally {
      await this.queries.closeConsole(connectionId, `compatibility-${connectionId}`).catch(() => undefined);
    }
  }
}
