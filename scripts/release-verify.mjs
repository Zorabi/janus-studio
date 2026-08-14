import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function readJson(relativePath) {
  return JSON.parse(await readFile(path.join(repositoryRoot, relativePath), "utf8"));
}

export async function verifyReleaseIdentity({ tag = process.env.GITHUB_REF_NAME, allowDirty = false } = {}) {
  const rootPackage = await readJson("package.json");
  const desktopPackage = await readJson("apps/desktop/package.json");
  const nodeVersion = (await readFile(path.join(repositoryRoot, ".nvmrc"), "utf8")).trim();
  const readme = await readFile(path.join(repositoryRoot, "README.md"), "utf8");
  const readmeZh = await readFile(path.join(repositoryRoot, "README.zh-CN.md"), "utf8");
  const failures = [];

  if (rootPackage.version !== desktopPackage.version) {
    failures.push(`Workspace version ${rootPackage.version} does not match desktop version ${desktopPackage.version}`);
  }
  if (rootPackage.packageManager !== "pnpm@8.11.0") {
    failures.push(`packageManager must be pnpm@8.11.0, received ${rootPackage.packageManager}`);
  }
  if (nodeVersion !== "22.17.0") failures.push(`.nvmrc must be 22.17.0, received ${nodeVersion}`);
  if (rootPackage.engines?.node !== ">=22.17.0 <23") {
    failures.push(`Node engine must be >=22.17.0 <23, received ${rootPackage.engines?.node ?? "missing"}`);
  }
  const badge = `version-${desktopPackage.version}-`;
  if (!readme.includes(badge)) failures.push(`README.md version badge does not contain ${desktopPackage.version}`);
  if (!readmeZh.includes(badge)) failures.push(`README.zh-CN.md version badge does not contain ${desktopPackage.version}`);
  if (tag && tag.startsWith("v") && tag !== `v${desktopPackage.version}`) {
    failures.push(`Git tag ${tag} must equal v${desktopPackage.version}`);
  }
  if (!allowDirty) {
    const status = execFileSync("git", ["status", "--porcelain"], { cwd: repositoryRoot, encoding: "utf8" }).trim();
    if (status) failures.push("Release worktree must be clean");
  }

  if (failures.length > 0) throw new Error(`Release identity verification failed:\n- ${failures.join("\n- ")}`);
  return { version: desktopPackage.version, nodeVersion, packageManager: rootPackage.packageManager, tag: tag?.startsWith("v") ? tag : null };
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  verifyReleaseIdentity({ allowDirty: process.argv.includes("--allow-dirty") })
    .then((result) => console.log(`Release identity verified: Janus Studio ${result.version} · Node ${result.nodeVersion} · ${result.packageManager}`))
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
