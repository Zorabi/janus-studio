import type {
  AuthenticationProfile,
  RuntimeAuthentication,
  SaveAuthenticationProfileInput,
} from "@janusgraph/domain";
import type { CredentialVault } from "../security/credential-vault";
import type { AuthenticationProfileRepository } from "../storage/authentication-profile-repository";

function parseHeaders(value: string): Record<string, string> {
  const parsed = JSON.parse(value) as Record<string, unknown>;
  return Object.fromEntries(Object.entries(parsed).map(([key, item]) => [key, String(item)]));
}

export class AuthenticationProfileService {
  private readonly secretCache = new Map<string, string>();
  private readonly headersCache = new Map<string, Record<string, string>>();

  constructor(
    private readonly repository: AuthenticationProfileRepository,
    private readonly credentialVault: CredentialVault,
  ) {}

  list(): AuthenticationProfile[] {
    return this.repository.list();
  }

  profile(id: string): AuthenticationProfile {
    const stored = this.repository.find(id);
    if (!stored) throw new Error("认证方案不存在或已被删除");
    return stored.profile;
  }

  async save(input: SaveAuthenticationProfileInput): Promise<AuthenticationProfile> {
    const id = input.id;
    const secretCipher = input.secret === undefined
      ? undefined
      : input.secret ? await this.credentialVault.encrypt(input.secret) : null;
    const headersCipher = input.sensitiveHeaders === undefined
      ? undefined
      : input.sensitiveHeaders.trim() && input.sensitiveHeaders.trim() !== "{}"
        ? await this.credentialVault.encrypt(input.sensitiveHeaders.trim())
        : null;
    const saved = this.repository.save(input, secretCipher, headersCipher);
    if (input.secret !== undefined) {
      if (input.secret) this.secretCache.set(saved.id, input.secret);
      else this.secretCache.delete(saved.id);
    }
    if (input.sensitiveHeaders !== undefined) {
      if (headersCipher) this.headersCache.set(saved.id, parseHeaders(input.sensitiveHeaders));
      else this.headersCache.delete(saved.id);
    }
    if (id && id !== saved.id) {
      this.secretCache.delete(id);
      this.headersCache.delete(id);
    }
    return saved;
  }

  remove(id: string): void {
    this.secretCache.delete(id);
    this.headersCache.delete(id);
    this.repository.remove(id);
  }

  async runtime(id: string): Promise<RuntimeAuthentication> {
    const stored = this.repository.find(id);
    if (!stored) throw new Error("认证方案不存在或已被删除");
    let secret = this.secretCache.get(id);
    if (secret === undefined) {
      secret = stored.secretCipher ? await this.credentialVault.decrypt(stored.secretCipher) : "";
      this.secretCache.set(id, secret);
    }
    let headers = this.headersCache.get(id);
    if (!headers) {
      const plaintext = stored.sensitiveHeadersCipher
        ? await this.credentialVault.decrypt(stored.sensitiveHeadersCipher)
        : "{}";
      headers = parseHeaders(plaintext);
      this.headersCache.set(id, headers);
    }
    return {
      mode: stored.profile.mode,
      username: stored.profile.username,
      secret,
      headerName: stored.profile.headerName,
      headers: { ...headers },
    };
  }
}
