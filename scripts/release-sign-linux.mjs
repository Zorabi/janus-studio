import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const makeRoot = path.join(repositoryRoot, "apps", "desktop", "out", "make");

async function collectPackages(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const location = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await collectPackages(location));
    else if (entry.isFile() && /\.(deb|rpm)$/i.test(entry.name)) files.push(location);
  }
  return files;
}

function runGpg(home, args, input) {
  const result = spawnSync("gpg", ["--batch", "--homedir", home, ...args], {
    encoding: "utf8",
    input,
    windowsHide: true,
  });
  if (result.status !== 0) throw new Error(`Linux release signing failed: ${result.stderr || result.stdout}`);
  return result;
}

export async function signLinuxPackages() {
  if (process.platform !== "linux") return { status: "not-applicable", signed: [] };
  const privateKey = process.env.LINUX_GPG_PRIVATE_KEY_BASE64;
  const keyId = process.env.LINUX_GPG_KEY_ID;
  if (!privateKey || !keyId) {
    console.log("Linux signing key is not configured; packages remain test-build artifacts.");
    return { status: "not-configured", signed: [] };
  }

  const packages = await collectPackages(makeRoot);
  if (packages.length === 0) throw new Error(`No Linux packages found under ${makeRoot}`);
  const home = mkdtempSync(path.join(tmpdir(), "janus-studio-gpg-"));
  try {
    const keyFile = path.join(home, "private-key.asc");
    writeFileSync(keyFile, Buffer.from(privateKey, "base64"), { mode: 0o600 });
    runGpg(home, ["--import", keyFile]);
    for (const packageFile of packages) {
      const signatureFile = `${packageFile}.asc`;
      const passphraseArgs = process.env.LINUX_GPG_PASSPHRASE
        ? ["--pinentry-mode", "loopback", "--passphrase-fd", "0"]
        : [];
      runGpg(home, [
        ...passphraseArgs,
        "--local-user", keyId,
        "--armor",
        "--detach-sign",
        "--output", signatureFile,
        packageFile,
      ], process.env.LINUX_GPG_PASSPHRASE ? `${process.env.LINUX_GPG_PASSPHRASE}\n` : undefined);
    }
    const publicKey = runGpg(home, ["--armor", "--export", keyId]).stdout;
    if (!publicKey.trim()) throw new Error("Linux signing key could not be exported for artifact verification");
    writeFileSync(path.join(makeRoot, "LINUX-SIGNING-KEY.asc"), publicKey, { mode: 0o644 });
    return { status: "signed", signed: packages };
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  signLinuxPackages()
    .then((result) => console.log(`Linux release signing: ${result.status} (${result.signed.length} package(s))`))
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
