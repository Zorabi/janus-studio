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
  enable_compression: number;
  custom_headers: string;
  password_cipher: Uint8Array | null;
  tls_client_key_passphrase_cipher: Uint8Array | null;
  proxy_password_cipher: Uint8Array | null;
  created_at: string;
  updated_at: string;
};

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
    enableCompression: row.enable_compression !== 0,
    customHeaders: row.custom_headers || "{}",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class ConnectionRepository {
  constructor(private readonly database: DatabaseSync) {}

  list(): ConnectionSummary[] {
    const rows = this.database
      .prepare("SELECT * FROM connection_profiles ORDER BY updated_at DESC")
      .all() as ConnectionRow[];

    return rows.map((row) => ({
      ...toProfile(row),
      hasPassword: row.password_cipher !== null,
      hasTlsClientKeyPassphrase: row.tls_client_key_passphrase_cipher !== null,
      hasProxyPassword: row.proxy_password_cipher !== null,
    }));
  }

  find(id: string): { profile: ConnectionProfile; passwordCipher: Uint8Array | null; tlsClientKeyPassphraseCipher: Uint8Array | null; proxyPasswordCipher: Uint8Array | null } | null {
    const row = this.database
      .prepare("SELECT * FROM connection_profiles WHERE id = ?")
      .get(id) as ConnectionRow | undefined;

    if (!row) return null;

    return {
      profile: toProfile(row),
      passwordCipher: row.password_cipher,
      tlsClientKeyPassphraseCipher: row.tls_client_key_passphrase_cipher,
      proxyPasswordCipher: row.proxy_password_cipher,
    };
  }

  save(
    id: string,
    input: SaveConnectionInput,
    passwordCipher: Uint8Array | null | undefined = undefined,
    tlsClientKeyPassphraseCipher: Uint8Array | null | undefined = undefined,
    proxyPasswordCipher: Uint8Array | null | undefined = undefined,
  ): ConnectionSummary {
    const existing = this.find(id);
    const now = new Date().toISOString();
    const createdAt = existing?.profile.createdAt ?? now;
    const cipher = passwordCipher === undefined ? existing?.passwordCipher ?? null : passwordCipher;
    const tlsPassphraseCipher = tlsClientKeyPassphraseCipher === undefined ? existing?.tlsClientKeyPassphraseCipher ?? null : tlsClientKeyPassphraseCipher;
    const proxyCipher = proxyPasswordCipher === undefined ? existing?.proxyPasswordCipher ?? null : proxyPasswordCipher;

    this.database
      .prepare(`
        INSERT INTO connection_profiles (
          id, name, protocol, host, port, path, username, environment, connection_read_only,
          client_mode, traversal_source, graph_binding, connect_timeout_ms, query_timeout_ms,
          tls_reject_unauthorized, tls_ca_path, tls_client_cert_path, tls_client_key_path,
          proxy_mode, proxy_url, proxy_host, proxy_port, proxy_bypass, proxy_username,
          enable_compression, custom_headers, password_cipher, tls_client_key_passphrase_cipher, proxy_password_cipher,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
          enable_compression = excluded.enable_compression,
          custom_headers = excluded.custom_headers,
          password_cipher = excluded.password_cipher,
          tls_client_key_passphrase_cipher = excluded.tls_client_key_passphrase_cipher,
          proxy_password_cipher = excluded.proxy_password_cipher,
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
        input.enableCompression ? 1 : 0,
        input.customHeaders,
        cipher,
        tlsPassphraseCipher,
        proxyCipher,
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
    };
  }

  remove(id: string): void {
    this.database.prepare("DELETE FROM connection_profiles WHERE id = ?").run(id);
  }
}
