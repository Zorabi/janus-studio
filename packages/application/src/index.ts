import type {
  CompatibilityCapability,
  CompatibilityProfile,
  ConnectionProfile,
  ConnectionProtocol,
  SaveConnectionInput,
} from "@janusgraph/domain";

export * from "./diagnostic-preview";

export type CompatibilityOperation =
  | "schemaManagement"
  | "schemaIndexLifecycle"
  | "officialSchemaJson"
  | "configuredGraphFactory"
  | "configuredGraphsonIo"
  | "graphsonIo"
  | "traversalExplain"
  | "traversalProfile";

export type CompatibilityRoute = {
  status: "available" | "unverified" | "unavailable";
  required: CompatibilityCapability[];
  unsupported: CompatibilityCapability[];
  unknown: CompatibilityCapability[];
};

const compatibilityRequirements: Record<CompatibilityOperation, CompatibilityCapability[]> = {
  schemaManagement: ["managementApi"],
  schemaIndexLifecycle: ["managementApi", "indexFieldStatus", "indexStatusAwait"],
  officialSchemaJson: ["jsonSchemaInitialization"],
  configuredGraphFactory: ["configuredGraphFactory", "configurationManagementGraph"],
  configuredGraphsonIo: ["configuredGraphFactory", "configurationManagementGraph", "graphsonIo"],
  graphsonIo: ["graphsonIo"],
  traversalExplain: ["traversalExplain"],
  traversalProfile: ["traversalProfile"],
};

export function routeCompatibility(
  profile: CompatibilityProfile | null | undefined,
  operation: CompatibilityOperation,
): CompatibilityRoute {
  const required = compatibilityRequirements[operation];
  if (!profile) {
    return { status: "unverified", required, unsupported: [], unknown: [...required] };
  }
  const unsupported = required.filter((capability) => profile.capabilities[capability] === "unsupported");
  const unknown = required.filter((capability) => profile.capabilities[capability] === "unknown");
  return {
    status: unsupported.length > 0 ? "unavailable" : unknown.length > 0 ? "unverified" : "available",
    required,
    unsupported,
    unknown,
  };
}

const secureProtocols = new Set<ConnectionProtocol>(["wss", "https"]);

export function connectionEndpoint(
  profile: Pick<ConnectionProfile, "protocol" | "host" | "port" | "path">,
): string {
  const path = profile.path.startsWith("/") ? profile.path : `/${profile.path}`;
  return `${profile.protocol}://${profile.host}:${profile.port}${path}`;
}

export function normalizeConnectionInput(
  input: SaveConnectionInput,
): SaveConnectionInput {
  return {
    ...input,
    name: input.name.trim(),
    host: input.host.trim(),
    path: input.path.trim() || "/gremlin",
    username: input.username.trim(),
    environment: input.environment ?? "dev",
    connectionReadOnly: input.connectionReadOnly ?? false,
    clientMode: input.clientMode ?? "sessionless",
    traversalSource: input.traversalSource.trim() || "g",
    graphBinding: input.graphBinding.trim() || "graph",
    tlsRejectUnauthorized: input.tlsRejectUnauthorized ?? true,
    enableCompression: input.enableCompression ?? false,
    customHeaders: input.customHeaders?.trim() || "{}",
  };
}

export function isSecureConnection(protocol: ConnectionProtocol): boolean {
  return secureProtocols.has(protocol);
}

export function isMutationQuery(query: string): boolean {
  const normalized = query
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/.*$/gm, " ")
    .replace(/'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"/g, "''");
  return /\.(?:addV|addE|mergeV|mergeE|property|drop|sideEffect|write|readGraph|makePropertyKey|makeVertexLabel|makeEdgeLabel|buildIndex|addIndexKey|updateIndex|changeName|setConsistency|setTTL|forceCloseInstance)\s*\(|\bcommit\s*\(|\bConfiguredGraphFactory\s*\.\s*(?:create|close|drop|createConfiguration|updateConfiguration|removeConfiguration|createTemplateConfiguration|updateTemplateConfiguration|removeTemplateConfiguration)\s*\(/i.test(normalized);
}

export function withTraversalConsoleText(
  query: string,
  step: "explain" | "profile",
): string {
  const source = query.trim().replace(/;\s*$/, "");
  const traversal = source
    .replace(/\.(?:explain|profile)\s*\(\s*\)(?:\.next\s*\(\s*\))?(?:\.toString\s*\(\s*\))?\s*$/i, "")
    .replace(/\.(?:toList|next|iterate)\s*\(\s*\)\s*$/, "");
  return step === "profile"
    ? `${traversal}.profile().next().toString()`
    : `${traversal}.explain().toString()`;
}

export function normalizeTraversalConsoleText(query: string): string {
  if (/\.profile\s*\(\s*\)(?:\.next\s*\(\s*\))?(?:\.toString\s*\(\s*\))?\s*;?\s*$/i.test(query)) return withTraversalConsoleText(query, "profile");
  if (/\.explain\s*\(\s*\)(?:\.next\s*\(\s*\))?(?:\.toString\s*\(\s*\))?\s*;?\s*$/i.test(query)) return withTraversalConsoleText(query, "explain");
  return query;
}

/**
 * JanusGraph ManagementSystem reaches backend driver objects that GraphSON
 * cannot serialize. Preserve the server-side binding but return a small map.
 */
export function normalizeManagementConsoleText(
  query: string,
  clientMode: "sessionless" | "sessioned",
): string {
  const assignmentMatch = query.match(
    /^\s*((?:def\s+)?([A-Za-z_$][\w$]*))\s*=\s*([A-Za-z_$][\w$]*(?:\s*\.\s*[A-Za-z_$][\w$]*)*)\s*\.\s*openManagement\s*\(\s*\)\s*;?\s*$/,
  );
  if (assignmentMatch) {
    const assignmentTarget = assignmentMatch[1]!;
    const variableName = assignmentMatch[2]!;
    const graphExpression = assignmentMatch[3]!.replace(/\s+/g, "");
    const scope = clientMode === "sessioned" ? "session" : "request";
    return `${assignmentTarget} = ${graphExpression}.openManagement(); [binding: "${variableName}", objectType: ${variableName}.getClass().getName(), state: "open", scope: "${scope}"]`;
  }

  const directMatch = query.match(
    /^\s*([A-Za-z_$][\w$]*(?:\s*\.\s*[A-Za-z_$][\w$]*)*)\s*\.\s*openManagement\s*\(\s*\)\s*;?\s*$/,
  );
  if (!directMatch) return query;

  const graphExpression = directMatch[1]!.replace(/\s+/g, "");
  return `def __janusStudioManagement = ${graphExpression}.openManagement(); try { [objectType: __janusStudioManagement.getClass().getName(), state: "opened-and-rolled-back", reusable: false] } finally { __janusStudioManagement.rollback() }`;
}
