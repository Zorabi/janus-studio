import type {
  ConnectionProfile,
  ConnectionSummary,
  SaveConnectionInput,
} from "@janusgraph/domain";
import type { DatabaseSync } from "node:sqlite";

type ConnectionRow = {
  id: string;
  name: string;
  protocol: ConnectionProfile["protocol"];
  host: string;
  port: number;
  path: string;
  username: string;
  environment: ConnectionProfile["environment"];
  connection_read_only: number;
  client_mode: ConnectionProfile["clientMode"];
  traversal_source: string;
  graph_binding: string;
  connect_timeout_ms: number;
  query_timeout_ms: number;
  tls_reject_unauthorized: number;
  tls_ca_path: string;
  tls_client_cert_path: string;
  tls_client_key_path: string;
  proxy_mode: ConnectionProfile["proxyMode"];
  proxy_url: string;
  proxy_host: string;
  proxy_port: number;
  proxy_bypass: string;
  proxy_username: string;
  auth_profile_id: string;
  ssh_enabled: number;
  ssh_host: string;
  ssh_port: number;
  ssh_username: string;
  ssh_auth_mode: ConnectionProfile["sshAuthMode"];
  ssh_private_key_path: string;
  ssh_agent_path: string;
  ssh_host_key_fingerprint: string;
  enable_compression: number;
  custom_headers: string;
  group_name: string;
  accent_color: string;
  tags_json: string;
  last_used_at: string;
  password_cipher: Uint8Array | null;
  tls_client_key_passphrase_cipher: Uint8Array | null;
  proxy_password_cipher: Uint8Array | null;
  sensitive_headers_cipher: Uint8Array | null;
  ssh_password_cipher: Uint8Array | null;
  ssh_private_key_passphrase_cipher: Uint8Array | null;
  created_at: string;
  updated_at: string;
};

function parseTags(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((tag): tag is string => typeof tag === "string") : [];
  } catch {
    return [];
  }
}

function toProfile(row: ConnectionRow): ConnectionProfile {
  return {
    id: row.id,
    name: row.name,
    protocol: row.protocol,
    host: row.host,
    port: row.port,
    path: row.path,
    username: row.username,
    environment: row.environment ?? "dev",
    connectionReadOnly: row.connection_read_only !== 0,
    clientMode: row.client_mode ?? "sessionless",
    traversalSource: row.traversal_source,
    graphBinding: row.graph_binding,
    connectTimeoutMs: row.connect_timeout_ms,
    queryTimeoutMs: row.query_timeout_ms,
    tlsRejectUnauthorized: row.tls_reject_unauthorized !== 0,
    tlsCaPath: row.tls_ca_path || "",
    tlsClientCertPath: row.tls_client_cert_path || "",
    tlsClientKeyPath: row.tls_client_key_path || "",
    proxyMode: row.proxy_mode ?? "direct",
    proxyUrl: row.proxy_url || "",
    proxyHost: row.proxy_host || "",
    proxyPort: row.proxy_port || 8080,
    proxyBypass: row.proxy_bypass || "",
    proxyUsername: row.proxy_username || "",
    authProfileId: row.auth_profile_id || "",
    sshEnabled: row.ssh_enabled !== 0,
    sshHost: row.ssh_host || "",
    sshPort: row.ssh_port || 22,
    sshUsername: row.ssh_username || "",
    sshAuthMode: row.ssh_auth_mode || "private-key",
    sshPrivateKeyPath: row.ssh_private_key_path || "",
    sshAgentPath: row.ssh_agent_path || "",
    sshHostKeyFingerprint: row.ssh_host_key_fingerprint || "",
    enableCompression: row.enable_compression !== 0,
    customHeaders: row.custom_headers || "{}",
    groupName: row.group_name || "",
    accentColor: row.accent_color || "#c8ff55",
    tags: parseTags(row.tags_json || "[]"),
    lastUsedAt: row.last_used_at || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class ConnectionRepository {
  constructor(private readonly database: DatabaseSync) {}

  list(): ConnectionSummary[] {
    const rows = this.database
      .prepare("SELECT * FROM connection_profiles ORDER BY CASE WHEN last_used_at = '' THEN 1 ELSE 0 END, last_used_at DESC, updated_at DESC")
      .all() as ConnectionRow[];

    return rows.map((row) => ({
      ...toProfile(row),
      hasPassword: row.password_cipher !== null,
      hasTlsClientKeyPassphrase: row.tls_client_key_passphrase_cipher !== null,
      hasProxyPassword: row.proxy_password_cipher !== null,
      hasSensitiveHeaders: row.sensitive_headers_cipher !== null,
      hasSshPassword: row.ssh_password_cipher !== null,
      hasSshPrivateKeyPassphrase: row.ssh_private_key_passphrase_cipher !== null,
    }));
  }

  find(id: string): { profile: ConnectionProfile; passwordCipher: Uint8Array | null; tlsClientKeyPassphraseCipher: Uint8Array | null; proxyPasswordCipher: Uint8Array | null; sensitiveHeadersCipher: Uint8Array | null; sshPasswordCipher: Uint8Array | null; sshPrivateKeyPassphraseCipher: Uint8Array | null } | null {
    const row = this.database
      .prepare("SELECT * FROM connection_profiles WHERE id = ?")
      .get(id) as ConnectionRow | undefined;

    if (!row) return null;

    return {
      profile: toProfile(row),
      passwordCipher: row.password_cipher,
      tlsClientKeyPassphraseCipher: row.tls_client_key_passphrase_cipher,
      proxyPasswordCipher: row.proxy_password_cipher,
      sensitiveHeadersCipher: row.sensitive_headers_cipher,
      sshPasswordCipher: row.ssh_password_cipher,
      sshPrivateKeyPassphraseCipher: row.ssh_private_key_passphrase_cipher,
    };
  }

  save(
    id: string,
    input: SaveConnectionInput,
    passwordCipher: Uint8Array | null | undefined = undefined,
    tlsClientKeyPassphraseCipher: Uint8Array | null | undefined = undefined,
    proxyPasswordCipher: Uint8Array | null | undefined = undefined,
    sensitiveHeadersCipher: Uint8Array | null | undefined = undefined,
    sshPasswordCipher: Uint8Array | null | undefined = undefined,
    sshPrivateKeyPassphraseCipher: Uint8Array | null | undefined = undefined,
  ): ConnectionSummary {
    const existing = this.find(id);
    const now = new Date().toISOString();
    const createdAt = existing?.profile.createdAt ?? now;
    const cipher = passwordCipher === undefined ? existing?.passwordCipher ?? null : passwordCipher;
    const tlsPassphraseCipher = tlsClientKeyPassphraseCipher === undefined ? existing?.tlsClientKeyPassphraseCipher ?? null : tlsClientKeyPassphraseCipher;
    const proxyCipher = proxyPasswordCipher === undefined ? existing?.proxyPasswordCipher ?? null : proxyPasswordCipher;
    const headersCipher = sensitiveHeadersCipher === undefined ? existing?.sensitiveHeadersCipher ?? null : sensitiveHeadersCipher;
    const tunnelPasswordCipher = sshPasswordCipher === undefined ? existing?.sshPasswordCipher ?? null : sshPasswordCipher;
    const tunnelPassphraseCipher = sshPrivateKeyPassphraseCipher === undefined ? existing?.sshPrivateKeyPassphraseCipher ?? null : sshPrivateKeyPassphraseCipher;

    this.database
      .prepare(`
        INSERT INTO connection_profiles (
          id, name, protocol, host, port, path, username, environment, connection_read_only,
          client_mode, traversal_source, graph_binding, connect_timeout_ms, query_timeout_ms,
          tls_reject_unauthorized, tls_ca_path, tls_client_cert_path, tls_client_key_path,
          proxy_mode, proxy_url, proxy_host, proxy_port, proxy_bypass, proxy_username,
          auth_profile_id, sensitive_headers_cipher,
          ssh_enabled, ssh_host, ssh_port, ssh_username, ssh_auth_mode, ssh_private_key_path, ssh_agent_path, ssh_host_key_fingerprint,
          ssh_password_cipher, ssh_private_key_passphrase_cipher,
          enable_compression, custom_headers, password_cipher, tls_client_key_passphrase_cipher, proxy_password_cipher,
          group_name, accent_color, tags_json, last_used_at,
          created_at, updated_at
        ) VALUES (${Array.from({ length: 47 }, () => "?").join(", ")})
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          protocol = excluded.protocol,
          host = excluded.host,
          port = excluded.port,
          path = excluded.path,
          username = excluded.username,
          environment = excluded.environment,
          connection_read_only = excluded.connection_read_only,
          client_mode = excluded.client_mode,
          traversal_source = excluded.traversal_source,
          graph_binding = excluded.graph_binding,
          connect_timeout_ms = excluded.connect_timeout_ms,
          query_timeout_ms = excluded.query_timeout_ms,
          tls_reject_unauthorized = excluded.tls_reject_unauthorized,
          tls_ca_path = excluded.tls_ca_path,
          tls_client_cert_path = excluded.tls_client_cert_path,
          tls_client_key_path = excluded.tls_client_key_path,
          proxy_mode = excluded.proxy_mode,
          proxy_url = excluded.proxy_url,
          proxy_host = excluded.proxy_host,
          proxy_port = excluded.proxy_port,
          proxy_bypass = excluded.proxy_bypass,
          proxy_username = excluded.proxy_username,
          auth_profile_id = excluded.auth_profile_id,
          sensitive_headers_cipher = excluded.sensitive_headers_cipher,
          ssh_enabled = excluded.ssh_enabled,
          ssh_host = excluded.ssh_host,
          ssh_port = excluded.ssh_port,
          ssh_username = excluded.ssh_username,
          ssh_auth_mode = excluded.ssh_auth_mode,
          ssh_private_key_path = excluded.ssh_private_key_path,
          ssh_agent_path = excluded.ssh_agent_path,
          ssh_host_key_fingerprint = excluded.ssh_host_key_fingerprint,
          ssh_password_cipher = excluded.ssh_password_cipher,
          ssh_private_key_passphrase_cipher = excluded.ssh_private_key_passphrase_cipher,
          enable_compression = excluded.enable_compression,
          custom_headers = excluded.custom_headers,
          password_cipher = excluded.password_cipher,
          tls_client_key_passphrase_cipher = excluded.tls_client_key_passphrase_cipher,
          proxy_password_cipher = excluded.proxy_password_cipher,
          group_name = excluded.group_name,
          accent_color = excluded.accent_color,
          tags_json = excluded.tags_json,
          updated_at = excluded.updated_at
      `)
      .run(
        id,
        input.name,
        input.protocol,
        input.host,
        input.port,
        input.path,
        input.username,
        input.environment,
        input.connectionReadOnly ? 1 : 0,
        input.clientMode,
        input.traversalSource,
        input.graphBinding,
        input.connectTimeoutMs,
        input.queryTimeoutMs,
        input.tlsRejectUnauthorized ? 1 : 0,
        input.tlsCaPath ?? "",
        input.tlsClientCertPath ?? "",
        input.tlsClientKeyPath ?? "",
        input.proxyMode ?? "direct",
        input.proxyUrl ?? "",
        input.proxyHost ?? "",
        input.proxyPort ?? 8080,
        input.proxyBypass ?? "",
        input.proxyUsername ?? "",
        input.authProfileId ?? "",
        headersCipher,
        input.sshEnabled ? 1 : 0,
        input.sshHost ?? "",
        input.sshPort ?? 22,
        input.sshUsername ?? "",
        input.sshAuthMode ?? "private-key",
        input.sshPrivateKeyPath ?? "",
        input.sshAgentPath ?? "",
        input.sshHostKeyFingerprint ?? "",
        tunnelPasswordCipher,
        tunnelPassphraseCipher,
        input.enableCompression ? 1 : 0,
        input.customHeaders,
        cipher,
        tlsPassphraseCipher,
        proxyCipher,
        input.groupName ?? "",
        input.accentColor ?? "#c8ff55",
        JSON.stringify(input.tags ?? []),
        existing?.profile.lastUsedAt ?? "",
        createdAt,
        now,
      );

    const saved = this.find(id);
    if (!saved) throw new Error("连接配置保存失败");

    return {
      ...saved.profile,
      hasPassword: saved.passwordCipher !== null,
      hasTlsClientKeyPassphrase: saved.tlsClientKeyPassphraseCipher !== null,
      hasProxyPassword: saved.proxyPasswordCipher !== null,
      hasSensitiveHeaders: saved.sensitiveHeadersCipher !== null,
      hasSshPassword: saved.sshPasswordCipher !== null,
      hasSshPrivateKeyPassphrase: saved.sshPrivateKeyPassphraseCipher !== null,
    };
  }

  remove(id: string): void {
    this.database.prepare("DELETE FROM connection_profiles WHERE id = ?").run(id);
  }

  markUsed(id: string): void {
    this.database.prepare("UPDATE connection_profiles SET last_used_at = ? WHERE id = ?").run(new Date().toISOString(), id);
  }
}
