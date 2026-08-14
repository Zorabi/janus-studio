import {
  connectionEndpoint,
  normalizeConnectionInput,
} from "@janusgraph/application";
import type {
  ConnectionProfile,
  ConnectionSummary,
  ConnectionTestReport,
  RuntimeAuthentication,
  SaveConnectionInput,
} from "@janusgraph/domain";
import { randomUUID } from "node:crypto";
import { CredentialVault } from "../security/credential-vault";
import { GremlinService } from "./gremlin-service";
import { ConnectionRepository } from "../storage/connection-repository";
import type { AuthenticationProfileService } from "./authentication-profile-service";

export type ConnectionRuntimeCredentials = {
  password: string;
  tlsClientKeyPassphrase: string;
  proxyPassword: string;
  sensitiveHeaders: Record<string, string>;
  sshPassword: string;
  sshPrivateKeyPassphrase: string;
  authentication: RuntimeAuthentication | null;
};

const sensitiveHeaderPattern = /^(?:authorization|proxy-authorization|cookie|set-cookie|x-api-key|x-auth-token|x-access-token)$/i;

function parseHeaders(value: string): Record<string, string> {
  const parsed = JSON.parse(value || "{}") as Record<string, unknown>;
  return Object.fromEntries(Object.entries(parsed).map(([key, item]) => [key, String(item)]));
}

function transientProfile(input: SaveConnectionInput): ConnectionProfile {
  const timestamp = new Date().toISOString();
  const {
    password: _password,
    tlsClientKeyPassphrase: _tlsClientKeyPassphrase,
    proxyPassword: _proxyPassword,
    sensitiveHeaders: _sensitiveHeaders,
    sshPassword: _sshPassword,
    sshPrivateKeyPassphrase: _sshPrivateKeyPassphrase,
    ...profile
  } = input;
  return {
    ...profile,
    // Connection tests must not reuse or tear down a live query session/tunnel.
    id: randomUUID(),
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export class ConnectionService {
  private readonly passwordCache = new Map<string, string>();
  private readonly tlsPassphraseCache = new Map<string, string>();
  private readonly proxyPasswordCache = new Map<string, string>();
  private readonly sensitiveHeadersCache = new Map<string, Record<string, string>>();
  private readonly sshPasswordCache = new Map<string, string>();
  private readonly sshPassphraseCache = new Map<string, string>();

  constructor(
    private readonly repository: ConnectionRepository,
    private readonly credentialVault: CredentialVault,
    private readonly gremlinService: GremlinService,
    private readonly authenticationProfiles?: AuthenticationProfileService,
  ) {}

  list(): ConnectionSummary[] {
    return this.repository.list().map((connection) => ({
      ...connection,
      sshTunnel: connection.sshEnabled
        ? this.gremlinService.sshTunnelSnapshot(connection.id)
        : undefined,
    }));
  }

  async save(rawInput: SaveConnectionInput): Promise<ConnectionSummary> {
    const input = normalizeConnectionInput(rawInput);
    const authProfile = input.authProfileId ? this.authenticationProfiles?.profile(input.authProfileId) : null;
    if (authProfile?.mode === "janus-hmac" && input.protocol !== "http" && input.protocol !== "https") {
      throw new Error("JanusGraph HMAC Token 仅支持 HTTP/HTTPS 连接");
    }
    const id = input.id ?? randomUUID();
    const passwordCipher =
      input.password === undefined
        ? undefined
        : input.password
          ? await this.credentialVault.encrypt(input.password)
          : null;
    const tlsClientKeyPassphraseCipher =
      input.tlsClientKeyPassphrase === undefined
        ? undefined
        : input.tlsClientKeyPassphrase
          ? await this.credentialVault.encrypt(input.tlsClientKeyPassphrase)
          : null;
    const proxyPasswordCipher =
      input.proxyPassword === undefined
        ? undefined
        : input.proxyPassword
          ? await this.credentialVault.encrypt(input.proxyPassword)
          : null;
    const sensitiveHeadersCipher = await this.encryptJsonSecret(input.sensitiveHeaders);
    const sshPasswordCipher = await this.encryptSecret(input.sshPassword);
    const sshPrivateKeyPassphraseCipher = await this.encryptSecret(input.sshPrivateKeyPassphrase);

    if (input.password !== undefined) {
      if (input.password) this.passwordCache.set(id, input.password);
      else this.passwordCache.delete(id);
    }
    if (input.tlsClientKeyPassphrase !== undefined) {
      if (input.tlsClientKeyPassphrase) this.tlsPassphraseCache.set(id, input.tlsClientKeyPassphrase);
      else this.tlsPassphraseCache.delete(id);
    }
    if (input.proxyPassword !== undefined) {
      if (input.proxyPassword) this.proxyPasswordCache.set(id, input.proxyPassword);
      else this.proxyPasswordCache.delete(id);
    }
    this.updateStringCache(this.sshPasswordCache, id, input.sshPassword);
    this.updateStringCache(this.sshPassphraseCache, id, input.sshPrivateKeyPassphrase);
    if (input.sensitiveHeaders !== undefined) {
      if (input.sensitiveHeaders.trim() && input.sensitiveHeaders.trim() !== "{}") {
        this.sensitiveHeadersCache.set(id, parseHeaders(input.sensitiveHeaders));
      } else this.sensitiveHeadersCache.delete(id);
    }

    await this.gremlinService.closeConnection(id);
    return this.repository.save(
      id,
      input,
      passwordCipher,
      tlsClientKeyPassphraseCipher,
      proxyPasswordCipher,
      sensitiveHeadersCipher,
      sshPasswordCipher,
      sshPrivateKeyPassphraseCipher,
    );
  }

  async remove(id: string): Promise<void> {
    await this.gremlinService.closeConnection(id);
    this.passwordCache.delete(id);
    this.tlsPassphraseCache.delete(id);
    this.proxyPasswordCache.delete(id);
    this.sensitiveHeadersCache.delete(id);
    this.sshPasswordCache.delete(id);
    this.sshPassphraseCache.delete(id);
    this.repository.remove(id);
  }

  async test(rawInput: SaveConnectionInput): Promise<ConnectionTestReport> {
    const input = normalizeConnectionInput(rawInput);
    const profile = transientProfile(input);
    const credentials = await this.credentials(input.id, input);
    const report = await this.gremlinService.test(profile, credentials);
    return { ...report, endpoint: connectionEndpoint(profile) };
  }

  async passwordFor(id: string): Promise<string> {
    return this.resolvePassword(id);
  }

  async tlsClientKeyPassphraseFor(id: string): Promise<string> {
    return this.resolveTlsPassphrase(id);
  }

  async proxyPasswordFor(id: string): Promise<string> {
    return this.resolveProxyPassword(id);
  }

  async credentialsFor(id: string): Promise<ConnectionRuntimeCredentials> {
    return this.credentials(id);
  }

  async migrateLegacySensitiveHeaders(): Promise<void> {
    for (const summary of this.repository.list()) {
      try {
        const headers = parseHeaders(summary.customHeaders);
        const sensitive = Object.fromEntries(Object.entries(headers).filter(([key]) => sensitiveHeaderPattern.test(key)));
        if (Object.keys(sensitive).length === 0) continue;
        const safe = Object.fromEntries(Object.entries(headers).filter(([key]) => !sensitiveHeaderPattern.test(key)));
        const existing = this.repository.find(summary.id);
        const merged = existing?.sensitiveHeadersCipher
          ? { ...parseHeaders(await this.credentialVault.decrypt(existing.sensitiveHeadersCipher)), ...sensitive }
          : sensitive;
        const cipher = await this.credentialVault.encrypt(JSON.stringify(merged));
        this.repository.save(summary.id, { ...summary, customHeaders: JSON.stringify(safe) }, undefined, undefined, undefined, cipher);
        this.sensitiveHeadersCache.set(summary.id, merged);
      } catch {
        // Keep an unreadable legacy value untouched instead of blocking startup.
      }
    }
  }

  profile(id: string): ConnectionProfile {
    const stored = this.repository.find(id);
    if (!stored) throw new Error("连接配置不存在或已被删除");
    return stored.profile;
  }

  private async resolvePassword(id?: string, inputPassword?: string): Promise<string> {
    if (inputPassword !== undefined) return inputPassword;
    if (!id) return "";

    const stored = this.repository.find(id);
    if (!stored?.passwordCipher) return "";
    const cached = this.passwordCache.get(id);
    if (cached !== undefined) return cached;
    const password = await this.credentialVault.decrypt(stored.passwordCipher);
    this.passwordCache.set(id, password);
    return password;
  }

  private async resolveTlsPassphrase(id?: string, inputPassphrase?: string): Promise<string> {
    if (inputPassphrase !== undefined) return inputPassphrase;
    if (!id) return "";
    const stored = this.repository.find(id);
    if (!stored?.tlsClientKeyPassphraseCipher) return "";
    const cached = this.tlsPassphraseCache.get(id);
    if (cached !== undefined) return cached;
    const passphrase = await this.credentialVault.decrypt(stored.tlsClientKeyPassphraseCipher);
    this.tlsPassphraseCache.set(id, passphrase);
    return passphrase;
  }

  private async resolveProxyPassword(id?: string, inputPassword?: string): Promise<string> {
    if (inputPassword !== undefined) return inputPassword;
    if (!id) return "";
    const stored = this.repository.find(id);
    if (!stored?.proxyPasswordCipher) return "";
    const cached = this.proxyPasswordCache.get(id);
    if (cached !== undefined) return cached;
    const password = await this.credentialVault.decrypt(stored.proxyPasswordCipher);
    this.proxyPasswordCache.set(id, password);
    return password;
  }

  private async credentials(id?: string, input?: SaveConnectionInput): Promise<ConnectionRuntimeCredentials> {
    const stored = id ? this.repository.find(id) : null;
    const sensitiveHeaders = input?.sensitiveHeaders !== undefined
      ? input.sensitiveHeaders.trim() ? parseHeaders(input.sensitiveHeaders) : {}
      : await this.resolveEncryptedHeaders(id, stored?.sensitiveHeadersCipher ?? null);
    const authentication = input?.authProfileId || stored?.profile.authProfileId
      ? await this.authenticationProfiles?.runtime(input?.authProfileId || stored!.profile.authProfileId) ?? null
      : null;
    const protocol = input?.protocol ?? stored?.profile.protocol;
    if (authentication?.mode === "janus-hmac" && protocol !== "http" && protocol !== "https") {
      throw new Error("JanusGraph HMAC Token 仅支持 HTTP/HTTPS 连接");
    }
    if (authentication && authentication.mode !== "custom-headers" && !authentication.secret) {
      throw new Error("认证方案尚未保存凭据");
    }
    return {
      password: await this.resolvePassword(id, input?.password),
      tlsClientKeyPassphrase: await this.resolveTlsPassphrase(id, input?.tlsClientKeyPassphrase),
      proxyPassword: await this.resolveProxyPassword(id, input?.proxyPassword),
      sensitiveHeaders,
      sshPassword: await this.resolveEncryptedString(id, input?.sshPassword, stored?.sshPasswordCipher ?? null, this.sshPasswordCache),
      sshPrivateKeyPassphrase: await this.resolveEncryptedString(id, input?.sshPrivateKeyPassphrase, stored?.sshPrivateKeyPassphraseCipher ?? null, this.sshPassphraseCache),
      authentication,
    };
  }

  private async resolveEncryptedHeaders(id: string | undefined, cipher: Uint8Array | null): Promise<Record<string, string>> {
    if (!id || !cipher) return {};
    const cached = this.sensitiveHeadersCache.get(id);
    if (cached) return { ...cached };
    const headers = parseHeaders(await this.credentialVault.decrypt(cipher));
    this.sensitiveHeadersCache.set(id, headers);
    return { ...headers };
  }

  private async resolveEncryptedString(
    id: string | undefined,
    input: string | undefined,
    cipher: Uint8Array | null,
    cache: Map<string, string>,
  ): Promise<string> {
    if (input !== undefined) return input;
    if (!id || !cipher) return "";
    const cached = cache.get(id);
    if (cached !== undefined) return cached;
    const value = await this.credentialVault.decrypt(cipher);
    cache.set(id, value);
    return value;
  }

  private async encryptSecret(value: string | undefined): Promise<Uint8Array | null | undefined> {
    return value === undefined ? undefined : value ? this.credentialVault.encrypt(value) : null;
  }

  private async encryptJsonSecret(value: string | undefined): Promise<Uint8Array | null | undefined> {
    return value === undefined ? undefined : value.trim() && value.trim() !== "{}"
      ? this.credentialVault.encrypt(value.trim())
      : null;
  }

  private updateStringCache(cache: Map<string, string>, id: string, value: string | undefined): void {
    if (value === undefined) return;
    if (value) cache.set(id, value);
    else cache.delete(id);
  }
}
