import {
  connectionEndpoint,
  normalizeConnectionInput,
} from "@janusgraph/application";
import type {
  ConnectionProfile,
  ConnectionSummary,
  ConnectionTestReport,
  SaveConnectionInput,
} from "@janusgraph/domain";
import { randomUUID } from "node:crypto";
import { CredentialVault } from "../security/credential-vault";
import { GremlinService } from "./gremlin-service";
import { ConnectionRepository } from "../storage/connection-repository";

function transientProfile(input: SaveConnectionInput): ConnectionProfile {
  const timestamp = new Date().toISOString();
  const { password: _password, tlsClientKeyPassphrase: _tlsClientKeyPassphrase, ...profile } = input;
  return {
    ...profile,
    id: input.id ?? randomUUID(),
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export class ConnectionService {
  private readonly passwordCache = new Map<string, string>();
  private readonly tlsPassphraseCache = new Map<string, string>();

  constructor(
    private readonly repository: ConnectionRepository,
    private readonly credentialVault: CredentialVault,
    private readonly gremlinService: GremlinService,
  ) {}

  list(): ConnectionSummary[] {
    return this.repository.list();
  }

  async save(rawInput: SaveConnectionInput): Promise<ConnectionSummary> {
    const input = normalizeConnectionInput(rawInput);
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

    if (input.password !== undefined) {
      if (input.password) this.passwordCache.set(id, input.password);
      else this.passwordCache.delete(id);
    }
    if (input.tlsClientKeyPassphrase !== undefined) {
      if (input.tlsClientKeyPassphrase) this.tlsPassphraseCache.set(id, input.tlsClientKeyPassphrase);
      else this.tlsPassphraseCache.delete(id);
    }

    await this.gremlinService.closeConnection(id);
    return this.repository.save(id, input, passwordCipher, tlsClientKeyPassphraseCipher);
  }

  async remove(id: string): Promise<void> {
    await this.gremlinService.closeConnection(id);
    this.passwordCache.delete(id);
    this.tlsPassphraseCache.delete(id);
    this.repository.remove(id);
  }

  async test(rawInput: SaveConnectionInput): Promise<ConnectionTestReport> {
    const input = normalizeConnectionInput(rawInput);
    const profile = transientProfile(input);
    const password = await this.resolvePassword(input.id, input.password);
    const tlsClientKeyPassphrase = await this.resolveTlsPassphrase(input.id, input.tlsClientKeyPassphrase);
    const report = await this.gremlinService.test(profile, password, tlsClientKeyPassphrase);
    return { ...report, endpoint: connectionEndpoint(profile) };
  }

  async passwordFor(id: string): Promise<string> {
    return this.resolvePassword(id);
  }

  async tlsClientKeyPassphraseFor(id: string): Promise<string> {
    return this.resolveTlsPassphrase(id);
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
}
