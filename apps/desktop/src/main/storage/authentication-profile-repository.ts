import type {
  AuthenticationProfile,
  SaveAuthenticationProfileInput,
} from "@janusgraph/domain";
import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

type AuthenticationProfileRow = {
  id: string;
  name: string;
  mode: AuthenticationProfile["mode"];
  username: string;
  header_name: string;
  secret_cipher: Uint8Array | null;
  sensitive_headers_cipher: Uint8Array | null;
  created_at: string;
  updated_at: string;
};

export type StoredAuthenticationProfile = {
  profile: AuthenticationProfile;
  secretCipher: Uint8Array | null;
  sensitiveHeadersCipher: Uint8Array | null;
};

function toStored(row: AuthenticationProfileRow): StoredAuthenticationProfile {
  return {
    profile: {
      id: row.id,
      name: row.name,
      mode: row.mode,
      username: row.username,
      headerName: row.header_name,
      hasSecret: row.secret_cipher !== null,
      hasSensitiveHeaders: row.sensitive_headers_cipher !== null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    },
    secretCipher: row.secret_cipher,
    sensitiveHeadersCipher: row.sensitive_headers_cipher,
  };
}

export class AuthenticationProfileRepository {
  constructor(private readonly database: DatabaseSync) {}

  list(): AuthenticationProfile[] {
    return (this.database.prepare("SELECT * FROM authentication_profiles ORDER BY name COLLATE NOCASE").all() as AuthenticationProfileRow[])
      .map((row) => toStored(row).profile);
  }

  find(id: string): StoredAuthenticationProfile | null {
    const row = this.database.prepare("SELECT * FROM authentication_profiles WHERE id = ?").get(id) as AuthenticationProfileRow | undefined;
    return row ? toStored(row) : null;
  }

  save(
    input: SaveAuthenticationProfileInput,
    secretCipher: Uint8Array | null | undefined,
    sensitiveHeadersCipher: Uint8Array | null | undefined,
  ): AuthenticationProfile {
    const id = input.id ?? randomUUID();
    const existing = this.find(id);
    const now = new Date().toISOString();
    const secret = secretCipher === undefined ? existing?.secretCipher ?? null : secretCipher;
    const headers = sensitiveHeadersCipher === undefined ? existing?.sensitiveHeadersCipher ?? null : sensitiveHeadersCipher;
    this.database.prepare(`
      INSERT INTO authentication_profiles (
        id, name, mode, username, header_name, secret_cipher, sensitive_headers_cipher, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        mode = excluded.mode,
        username = excluded.username,
        header_name = excluded.header_name,
        secret_cipher = excluded.secret_cipher,
        sensitive_headers_cipher = excluded.sensitive_headers_cipher,
        updated_at = excluded.updated_at
    `).run(
      id,
      input.name,
      input.mode,
      input.username,
      input.headerName,
      secret,
      headers,
      existing?.profile.createdAt ?? now,
      now,
    );
    return this.find(id)!.profile;
  }

  remove(id: string): void {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.database.prepare("UPDATE connection_profiles SET auth_profile_id = '' WHERE auth_profile_id = ?").run(id);
      this.database.prepare("DELETE FROM authentication_profiles WHERE id = ?").run(id);
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }
}
