import type { ConnectionSummary, SaveConnectionInput } from "@janusgraph/domain";

export const CONNECTION_WORKSPACE_FORMAT = "janus-studio.connections/v1" as const;

export type ConnectionCredentialKind =
  | "password"
  | "authentication-profile"
  | "mtls"
  | "proxy-password"
  | "sensitive-headers"
  | "custom-headers"
  | "ssh";

export type PortableConnection = {
  sourceId: string;
  input: SaveConnectionInput;
  credentialKinds: ConnectionCredentialKind[];
};

export type ConnectionWorkspaceArchive = {
  format: typeof CONNECTION_WORKSPACE_FORMAT;
  exportedAt: string;
  credentialsIncluded: false;
  connections: PortableConnection[];
};

export type ConnectionImportPlanRow = PortableConnection & {
  status: "create" | "update" | "skip" | "conflict";
  existing?: ConnectionSummary;
};

const credentialKinds = new Set<ConnectionCredentialKind>([
  "password",
  "authentication-profile",
  "mtls",
  "proxy-password",
  "sensitive-headers",
  "custom-headers",
  "ssh",
]);
const sensitiveHeaderPattern = /^(?:authorization|proxy-authorization|cookie|set-cookie|x-api-key|x-auth-token|x-access-token)$/i;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function localTimestamp(value = new Date()): string {
  const pad = (item: number, size = 2) => String(item).padStart(size, "0");
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())} ${pad(value.getHours())}:${pad(value.getMinutes())}:${pad(value.getSeconds())}`;
}

function safeHeaders(value: string): string {
  try {
    const parsed = JSON.parse(value || "{}") as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return "{}";
    return JSON.stringify(Object.fromEntries(Object.entries(parsed)
      .filter(([key, item]) => !sensitiveHeaderPattern.test(key) && typeof item === "string")));
  } catch {
    return "{}";
  }
}

function portableProxy(connection: ConnectionSummary): { proxyUrl: string; proxyHost: string; proxyPort: number } {
  if (!connection.proxyUrl) {
    return { proxyUrl: "", proxyHost: connection.proxyHost, proxyPort: connection.proxyPort };
  }
  try {
    const url = new URL(connection.proxyUrl.includes("://") ? connection.proxyUrl : `http://${connection.proxyUrl}`);
    return {
      proxyUrl: "",
      proxyHost: url.hostname || connection.proxyHost,
      proxyPort: Number(url.port) || (url.protocol === "https:" ? 443 : 80),
    };
  } catch {
    return { proxyUrl: "", proxyHost: connection.proxyHost, proxyPort: connection.proxyPort };
  }
}

function portableFromSummary(connection: ConnectionSummary): PortableConnection {
  const {
    id,
    createdAt: _createdAt,
    updatedAt: _updatedAt,
    lastUsedAt: _lastUsedAt,
    hasPassword,
    hasTlsClientKeyPassphrase: _hasTlsClientKeyPassphrase,
    hasProxyPassword,
    hasSensitiveHeaders,
    hasSshPassword: _hasSshPassword,
    hasSshPrivateKeyPassphrase: _hasSshPrivateKeyPassphrase,
    sshTunnel: _sshTunnel,
    tlsCaPath,
    tlsClientCertPath,
    tlsClientKeyPath,
    authProfileId,
    sshEnabled,
    sshPrivateKeyPath,
    sshAgentPath,
    ...safeProfile
  } = connection;
  const proxy = portableProxy(connection);
  const kinds: ConnectionCredentialKind[] = [];
  if (hasPassword) kinds.push("password");
  if (authProfileId) kinds.push("authentication-profile");
  if (tlsCaPath || tlsClientCertPath || tlsClientKeyPath) kinds.push("mtls");
  if (hasProxyPassword) kinds.push("proxy-password");
  if (hasSensitiveHeaders) kinds.push("sensitive-headers");
  if (safeHeaders(connection.customHeaders) !== "{}") kinds.push("custom-headers");
  if (sshEnabled) kinds.push("ssh");
  return {
    sourceId: id,
    credentialKinds: kinds,
    input: {
      ...safeProfile,
      customHeaders: "{}",
      ...proxy,
      tlsCaPath: "",
      tlsClientCertPath: "",
      tlsClientKeyPath: "",
      authProfileId: "",
      sshEnabled: false,
      sshPrivateKeyPath: "",
      sshAgentPath: "",
    },
  };
}

export function createConnectionWorkspaceArchive(connections: ConnectionSummary[]): ConnectionWorkspaceArchive {
  return {
    format: CONNECTION_WORKSPACE_FORMAT,
    exportedAt: localTimestamp(),
    credentialsIncluded: false,
    connections: connections.map(portableFromSummary),
  };
}

function recordValue(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(message);
  return value as Record<string, unknown>;
}

function stringValue(record: Record<string, unknown>, key: string, fallback = ""): string {
  const value = record[key];
  if (value === undefined) return fallback;
  if (typeof value !== "string") throw new Error(`连接字段 ${key} 格式无效`);
  return value;
}

function numberValue(record: Record<string, unknown>, key: string, fallback: number): number {
  const value = record[key] ?? fallback;
  if (typeof value !== "number" || !Number.isInteger(value)) throw new Error(`连接字段 ${key} 格式无效`);
  return value;
}

function booleanValue(record: Record<string, unknown>, key: string, fallback: boolean): boolean {
  const value = record[key] ?? fallback;
  if (typeof value !== "boolean") throw new Error(`连接字段 ${key} 格式无效`);
  return value;
}

function enumValue<T extends string>(record: Record<string, unknown>, key: string, values: readonly T[], fallback: T): T {
  const value = record[key] ?? fallback;
  if (typeof value !== "string" || !values.includes(value as T)) throw new Error(`连接字段 ${key} 格式无效`);
  return value as T;
}

function parsePortableConnection(value: unknown, index: number): PortableConnection {
  const row = recordValue(value, `第 ${index + 1} 个连接格式无效`);
  const raw = recordValue(row.input, `第 ${index + 1} 个连接缺少 input`);
  for (const forbidden of ["id", "password", "tlsClientKeyPassphrase", "proxyPassword", "sensitiveHeaders", "sshPassword", "sshPrivateKeyPassphrase"]) {
    if (Object.hasOwn(raw, forbidden)) throw new Error(`连接工作区包含禁止导入的凭据字段：${forbidden}`);
  }
  const name = stringValue(raw, "name").trim();
  const host = stringValue(raw, "host").trim();
  const traversalSource = stringValue(raw, "traversalSource").trim();
  const graphBinding = stringValue(raw, "graphBinding").trim();
  if (!name || !host || !traversalSource || !graphBinding) throw new Error(`第 ${index + 1} 个连接缺少必要字段`);
  const tagsValue = raw.tags ?? [];
  if (!Array.isArray(tagsValue) || tagsValue.some((tag) => typeof tag !== "string")) throw new Error(`第 ${index + 1} 个连接标签格式无效`);
  const sourceId = typeof row.sourceId === "string" && uuidPattern.test(row.sourceId) ? row.sourceId : "";
  const rawKinds = Array.isArray(row.credentialKinds) ? row.credentialKinds : [];
  return {
    sourceId,
    credentialKinds: rawKinds.filter((kind): kind is ConnectionCredentialKind => typeof kind === "string" && credentialKinds.has(kind as ConnectionCredentialKind)),
    input: {
      name,
      protocol: enumValue(raw, "protocol", ["ws", "wss", "http", "https"], "ws"),
      host,
      port: numberValue(raw, "port", 8182),
      path: stringValue(raw, "path", "/gremlin"),
      username: stringValue(raw, "username"),
      environment: enumValue(raw, "environment", ["dev", "test", "prod"], "dev"),
      connectionReadOnly: booleanValue(raw, "connectionReadOnly", false),
      clientMode: enumValue(raw, "clientMode", ["sessionless", "sessioned"], "sessionless"),
      traversalSource,
      graphBinding,
      connectTimeoutMs: numberValue(raw, "connectTimeoutMs", 10_000),
      queryTimeoutMs: numberValue(raw, "queryTimeoutMs", 30_000),
      tlsRejectUnauthorized: booleanValue(raw, "tlsRejectUnauthorized", true),
      tlsCaPath: "",
      tlsClientCertPath: "",
      tlsClientKeyPath: "",
      proxyMode: enumValue(raw, "proxyMode", ["direct", "system", "manual"], "direct"),
      proxyUrl: stringValue(raw, "proxyUrl"),
      proxyHost: stringValue(raw, "proxyHost"),
      proxyPort: numberValue(raw, "proxyPort", 8080),
      proxyBypass: stringValue(raw, "proxyBypass"),
      proxyUsername: stringValue(raw, "proxyUsername"),
      authProfileId: "",
      sshEnabled: false,
      sshHost: stringValue(raw, "sshHost"),
      sshPort: numberValue(raw, "sshPort", 22),
      sshUsername: stringValue(raw, "sshUsername"),
      sshAuthMode: enumValue(raw, "sshAuthMode", ["password", "private-key", "agent"], "private-key"),
      sshPrivateKeyPath: "",
      sshAgentPath: "",
      sshHostKeyFingerprint: stringValue(raw, "sshHostKeyFingerprint"),
      enableCompression: booleanValue(raw, "enableCompression", false),
      customHeaders: safeHeaders(stringValue(raw, "customHeaders", "{}")),
      groupName: stringValue(raw, "groupName"),
      accentColor: enumValue(raw, "accentColor", ["#c8ff55", "#83bcff", "#efb45e", "#ff746a", "#b8a3ff", "#69dfb0"], "#c8ff55"),
      tags: tagsValue.map((tag) => tag.trim()).filter(Boolean).slice(0, 12),
    },
  };
}

export function parseConnectionWorkspaceArchive(content: string): ConnectionWorkspaceArchive {
  const root = recordValue(JSON.parse(content) as unknown, "连接工作区文件格式无效");
  if (root.format !== CONNECTION_WORKSPACE_FORMAT || root.credentialsIncluded !== false || !Array.isArray(root.connections)) {
    throw new Error("不是受支持的 Janus Studio 连接工作区文件");
  }
  if (root.connections.length > 200) throw new Error("单个连接工作区最多包含 200 个连接");
  return {
    format: CONNECTION_WORKSPACE_FORMAT,
    exportedAt: typeof root.exportedAt === "string" ? root.exportedAt : "",
    credentialsIncluded: false,
    connections: root.connections.map(parsePortableConnection),
  };
}

function identity(input: SaveConnectionInput): string {
  return `${input.protocol}://${input.host.toLocaleLowerCase()}:${input.port}${input.path}|${input.graphBinding}|${input.traversalSource}`;
}

function comparable(input: SaveConnectionInput): string {
  const { id: _id, ...value } = input;
  return JSON.stringify(value);
}

export function planConnectionWorkspaceImport(
  archive: ConnectionWorkspaceArchive,
  existing: ConnectionSummary[],
): ConnectionImportPlanRow[] {
  const claimed = new Set<string>();
  return archive.connections.map((entry) => {
    const match = existing.find((connection) => !claimed.has(connection.id) && (
      (entry.sourceId && connection.id === entry.sourceId)
      || identity(connection) === identity(entry.input)
    ));
    if (match) {
      claimed.add(match.id);
      const same = comparable(portableFromSummary(match).input) === comparable(entry.input);
      return { ...entry, existing: match, status: same ? "skip" : "update" };
    }
    const nameConflict = existing.find((connection) => !claimed.has(connection.id)
      && connection.name.toLocaleLowerCase() === entry.input.name.toLocaleLowerCase());
    if (nameConflict) return { ...entry, existing: nameConflict, status: "conflict" };
    return { ...entry, status: "create" };
  });
}

export function connectionImportInput(row: ConnectionImportPlanRow): SaveConnectionInput {
  if (row.status !== "update" || !row.existing) return row.input;
  return {
    ...row.input,
    id: row.existing.id,
    authProfileId: row.existing.authProfileId,
    tlsCaPath: row.existing.tlsCaPath,
    tlsClientCertPath: row.existing.tlsClientCertPath,
    tlsClientKeyPath: row.existing.tlsClientKeyPath,
    sshEnabled: row.existing.sshEnabled,
    sshPrivateKeyPath: row.existing.sshPrivateKeyPath,
    sshAgentPath: row.existing.sshAgentPath,
    customHeaders: row.existing.customHeaders,
  };
}
