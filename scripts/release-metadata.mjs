import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream, readFileSync } from "node:fs";
import { lstat, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { verifyReleaseIdentity } from "./release-verify.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const makeRoot = path.join(repositoryRoot, "apps", "desktop", "out", "make");
const platformId = `${process.platform}-${process.arch}`;
const knownLimitationsSource = path.join(repositoryRoot, "docs", "发布已知限制.md");

function isGeneratedMetadata(name) {
  return name.startsWith("SHA256SUMS-") || name.startsWith("release-manifest-") || name.startsWith("sbom-") || name.startsWith("RELEASE-NOTES-") || name.startsWith("KNOWN-LIMITATIONS-");
}

function isInstallerArtifact(file) {
  const name = path.basename(file).toLowerCase();
  return [".zip", ".dmg", ".exe", ".deb", ".rpm", ".nupkg", ".appimage"].some((extension) => name.endsWith(extension)) || name === "releases";
}

async function collectFiles(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const location = path.join(directory, entry.name);
    const details = await lstat(location);
    if (details.isSymbolicLink()) continue;
    if (details.isDirectory()) result.push(...await collectFiles(location));
    else if (details.isFile() && entry.name !== ".DS_Store" && details.size > 0) result.push(location);
  }
  return result;
}

async function sha256(file) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

function packageUrl(name, version) {
  const encodedName = name.startsWith("@")
    ? `%40${name.slice(1).split("/").map(encodeURIComponent).join("/")}`
    : encodeURIComponent(name);
  return `pkg:npm/${encodedName}@${encodeURIComponent(version)}`;
}

function flattenDependencies(dependencies, components) {
  for (const [name, dependency] of Object.entries(dependencies ?? {})) {
    let version = dependency.version;
    if (typeof version !== "string" || version.startsWith("link:")) {
      try { version = JSON.parse(readFileSync(path.join(dependency.path, "package.json"), "utf8")).version; }
      catch { version = "0.0.0-workspace"; }
    }
    const key = `${name}@${version}`;
    if (!components.has(key)) components.set(key, { type: "library", name, version, purl: packageUrl(name, version) });
    flattenDependencies(dependency.dependencies, components);
  }
}

await mkdir(makeRoot, { recursive: true });
const identity = await verifyReleaseIdentity({ allowDirty: process.argv.includes("--allow-dirty") });
const gitCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repositoryRoot, encoding: "utf8" }).trim();
const generatedAt = new Date().toISOString();
const previousTag = (() => {
  try { return execFileSync("git", ["describe", "--tags", "--abbrev=0", "HEAD^"], { cwd: repositoryRoot, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); }
  catch { return ""; }
})();
const revisionRange = previousTag ? `${previousTag}..HEAD` : "HEAD";
const commitLines = execFileSync("git", ["log", "--no-merges", "--format=- `%h` %s", "-50", revisionRange], { cwd: repositoryRoot, encoding: "utf8" }).trim();
const releaseNotesName = `RELEASE-NOTES-${identity.version}.md`;
const knownLimitationsName = `KNOWN-LIMITATIONS-${identity.version}.md`;
const existingInstallerArtifacts = (await collectFiles(makeRoot)).filter((file) => !isGeneratedMetadata(path.basename(file)) && isInstallerArtifact(file));
if (existingInstallerArtifacts.length === 0) throw new Error("No installer artifacts found under apps/desktop/out/make; run pnpm make first");
await writeFile(path.join(makeRoot, releaseNotesName), `# Janus Studio ${identity.version} Release Notes\n\nGenerated: ${generatedAt}\nCommit: \`${gitCommit}\`\n${previousTag ? `Changes since: \`${previousTag}\`\n` : "No previous Git tag was found; showing the latest 50 commits.\n"}\n## Changes\n\n${commitLines || "- No commits found."}\n`, "utf8");
await writeFile(path.join(makeRoot, knownLimitationsName), await readFile(knownLimitationsSource, "utf8"), "utf8");
const files = (await collectFiles(makeRoot)).filter((file) => !isGeneratedMetadata(path.basename(file)) || [releaseNotesName, knownLimitationsName].includes(path.basename(file))).sort();

const artifacts = [];
for (const file of files) {
  const details = await lstat(file);
  artifacts.push({
    path: path.relative(makeRoot, file).replaceAll(path.sep, "/"),
    size: details.size,
    sha256: await sha256(file),
  });
}

const verificationName = `release-verification-${platformId}.json`;
const verification = await readFile(path.join(makeRoot, verificationName), "utf8")
  .then(JSON.parse)
  .catch(() => null);
const signing = verification?.overall ?? {
  signature: process.platform === "darwin" ? "ad-hoc" : "unsigned",
  notarization: process.platform === "darwin" ? "missing" : "not-applicable",
  installability: "not-checked",
  officialReady: false,
};
const officialIdentity = signing.officialReady === true;
const releaseClass = officialIdentity ? "official-release" : "test-build";
if (process.env.JANUS_STUDIO_REQUIRE_OFFICIAL_RELEASE === "1" && releaseClass !== "official-release") {
  throw new Error(`Official release requirements are not satisfied for ${platformId}: ${JSON.stringify(signing)}`);
}
const manifest = {
  schemaVersion: 1,
  product: "Janus Studio",
  version: identity.version,
  releaseClass,
  platform: process.platform,
  architecture: process.arch,
  generatedAt,
  gitCommit,
  tag: identity.tag,
  signing,
  verification: verification
    ? { report: verificationName, artifactsChecked: verification.artifacts?.length ?? 0 }
    : { report: null, artifactsChecked: 0 },
  documentation: { releaseNotes: releaseNotesName, knownLimitations: knownLimitationsName },
  artifacts,
  notices: releaseClass === "test-build"
    ? [verification
        ? "Artifact verification did not satisfy official release requirements; this is a test build."
        : "Artifact verification was not run; this is a test build and must not be presented as an officially signed release."]
    : [],
};

const pnpmCommand = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const dependencyTree = JSON.parse(execFileSync(pnpmCommand, ["list", "--prod", "--recursive", "--depth", "Infinity", "--json"], { cwd: repositoryRoot, encoding: "utf8", maxBuffer: 20 * 1024 * 1024 }));
const components = new Map();
for (const workspace of dependencyTree) flattenDependencies(workspace.dependencies, components);
const sbom = {
  bomFormat: "CycloneDX",
  specVersion: "1.6",
  serialNumber: `urn:uuid:${randomUUID()}`,
  version: 1,
  metadata: {
    timestamp: generatedAt,
    component: { type: "application", name: "Janus Studio", version: identity.version, purl: packageUrl("@janusgraph/desktop", identity.version) },
    properties: [
      { name: "janus-studio:git-commit", value: gitCommit },
      { name: "janus-studio:release-class", value: releaseClass },
    ],
  },
  components: [...components.values()].sort((left, right) => left.purl.localeCompare(right.purl)),
};

await writeFile(path.join(makeRoot, `release-manifest-${platformId}.json`), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
await writeFile(path.join(makeRoot, `sbom-${platformId}.cdx.json`), `${JSON.stringify(sbom, null, 2)}\n`, "utf8");
const checksumFile = `SHA256SUMS-${platformId}.txt`;
const checksumEntries = [];
for (const file of (await collectFiles(makeRoot)).filter((file) => path.basename(file) !== checksumFile).sort()) {
  checksumEntries.push(`${await sha256(file)}  ${path.relative(makeRoot, file).replaceAll(path.sep, "/")}`);
}
await writeFile(path.join(makeRoot, checksumFile), `${checksumEntries.join("\n")}\n`, "utf8");
console.log(`Generated release manifest, CycloneDX SBOM (${components.size} components) and ${checksumEntries.length} checksums for ${platformId} [${releaseClass}]`);
