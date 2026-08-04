import type { SecurityStorageStatus } from "@janusgraph/domain";
import { safeStorage } from "electron";
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";
import { chmod, readFile, stat, writeFile } from "node:fs/promises";

const HEADER = Buffer.from("JGO1");
const OS_STORAGE = 1;
const LOCAL_STORAGE = 2;
const IV_BYTES = 12;
const TAG_BYTES = 16;

export class CredentialVault {
  private lastMode: SecurityStorageStatus["mode"] = "os";

  constructor(
    private readonly fallbackKeyPath: string,
    private readonly forceLocal = false,
  ) {
    if (forceLocal) this.lastMode = "local-fallback";
  }

  async encrypt(password: string): Promise<Uint8Array> {
    if (!this.forceLocal && safeStorage.isEncryptionAvailable()) {
      try {
        const cipher = safeStorage.encryptString(password);
        this.lastMode = "os";
        return Buffer.concat([HEADER, Buffer.from([OS_STORAGE]), cipher]);
      } catch {
        // A moved or unsigned macOS build can lose access to the previous
        // Keychain item. The restricted local vault keeps the app usable.
      }
    }

    const key = await this.localKey();
    if (!key) throw new Error("无法创建本地凭据密钥");
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const encrypted = Buffer.concat([
      cipher.update(password, "utf8"),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();
    this.lastMode = "local-fallback";
    return Buffer.concat([
      HEADER,
      Buffer.from([LOCAL_STORAGE]),
      iv,
      tag,
      encrypted,
    ]);
  }

  async decrypt(cipher: Uint8Array): Promise<string> {
    const payload = Buffer.from(cipher);
    if (payload.subarray(0, HEADER.length).equals(HEADER)) {
      const kind = payload[HEADER.length];
      const body = payload.subarray(HEADER.length + 1);
      if (kind === OS_STORAGE) {
        if (this.forceLocal) {
          throw new Error("当前隔离运行环境不允许访问操作系统密钥设施");
        }
        try {
          const password = safeStorage.decryptString(body);
          this.lastMode = "os";
          return password;
        } catch {
          throw new Error(
            "保存的密码属于旧程序的系统密钥，请编辑此连接并重新输入密码完成迁移",
          );
        }
      }
      if (kind === LOCAL_STORAGE) {
        const key = await this.localKey(false);
        if (!key) {
          throw new Error("本地凭据密钥丢失，请编辑此连接并重新输入密码");
        }
        const iv = body.subarray(0, IV_BYTES);
        const tag = body.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
        const encrypted = body.subarray(IV_BYTES + TAG_BYTES);
        try {
          const decipher = createDecipheriv("aes-256-gcm", key, iv);
          decipher.setAuthTag(tag);
          this.lastMode = "local-fallback";
          return Buffer.concat([
            decipher.update(encrypted),
            decipher.final(),
          ]).toString("utf8");
        } catch {
          throw new Error("本地凭据无法解密，请编辑此连接并重新输入密码");
        }
      }
    }

    if (this.forceLocal) {
      throw new Error("当前隔离运行环境不允许读取迁移前的系统凭据");
    }
    try {
      const password = safeStorage.decryptString(payload);
      this.lastMode = "os";
      return password;
    } catch {
      throw new Error(
        "保存的密码属于迁移前程序，请编辑此连接并重新输入密码完成迁移",
      );
    }
  }

  async status(): Promise<SecurityStorageStatus> {
    const fallbackKeyPresent = await stat(this.fallbackKeyPath)
      .then(() => true)
      .catch(() => false);
    const osEncryptionAvailable = !this.forceLocal && safeStorage.isEncryptionAvailable();
    const mode = osEncryptionAvailable ? this.lastMode : "local-fallback";
    return {
      mode,
      osEncryptionAvailable,
      fallbackKeyPresent,
      description:
        mode === "os"
          ? "密码由操作系统密钥设施保护"
          : "密码由当前用户目录中的 AES-256-GCM 本地密钥保护",
    };
  }

  private async localKey(create = true): Promise<Buffer | null> {
    try {
      const key = await readFile(this.fallbackKeyPath);
      if (key.length !== 32) throw new Error("invalid local credential key");
      return key;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (!create && code === "ENOENT") return null;
      if (code !== "ENOENT") throw error;
    }

    const key = randomBytes(32);
    try {
      await writeFile(this.fallbackKeyPath, key, {
        flag: "wx",
        mode: 0o600,
      });
      await chmod(this.fallbackKeyPath, 0o600).catch(() => undefined);
      return key;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const existing = await readFile(this.fallbackKeyPath);
      if (existing.length !== 32) throw new Error("invalid local credential key");
      return existing;
    }
  }
}
