import assert from "node:assert/strict";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CredentialVault } from "../../apps/desktop/src/main/security/credential-vault";

test("force-local credential vault uses AES without loading OS storage", async () => {
  const directory = await mkdtemp(join(tmpdir(), "jgo-credential-vault-"));
  const keyPath = join(directory, "credential-vault.key");

  try {
    const vault = new CredentialVault(keyPath, true);
    const cipher = Buffer.from(await vault.encrypt("local-secret"));

    assert.equal(cipher.subarray(0, 4).toString("utf8"), "JGO1");
    assert.equal(cipher[4], 2);
    assert.equal(await vault.decrypt(cipher), "local-secret");

    const status = await vault.status();
    assert.equal(status.mode, "local-fallback");
    assert.equal(status.osEncryptionAvailable, false);
    assert.equal(status.fallbackKeyPresent, true);
    assert.equal((await stat(keyPath)).mode & 0o777, 0o600);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
