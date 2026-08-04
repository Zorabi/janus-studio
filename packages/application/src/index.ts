import type {
  ConnectionProfile,
  ConnectionProtocol,
  SaveConnectionInput,
} from "@janusgraph/domain";

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
