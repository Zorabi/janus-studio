import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const makeRoot = path.join(repositoryRoot, "apps", "desktop", "out", "make");
const packageRoot = path.join(repositoryRoot, "apps", "desktop", "out");

function command(command, args) {
  return spawnSync(command, args, { encoding: "utf8", windowsHide: true });
}

function evidence(result) {
  return `${result.stdout ?? ""}${result.stderr ?? ""}`
    .replaceAll(repositoryRoot, "<repository>")
    .replaceAll(process.env.RUNNER_TEMP ?? "\0", "<runner-temp>")
    .trim()
    .slice(0, 4_000);
}

async function collectFiles(directory) {
  if (!existsSync(directory)) return [];
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const location = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await collectFiles(location));
    else if (entry.isFile() && entry.name !== ".DS_Store") files.push(location);
  }
  return files;
}

export function classifyMacVerification({ codesignStatus, codesignDetails = "", staplerStatus, gatekeeperStatus }) {
  const developerId = /Authority=Developer ID Application:/m.test(codesignDetails);
  const adHoc = /Signature=adhoc/m.test(codesignDetails) || /Authority=Apple Development:/m.test(codesignDetails);
  const signature = codesignStatus !== 0 ? "invalid" : developerId ? "verified" : adHoc ? "ad-hoc" : "untrusted";
  const notarization = staplerStatus === 0 ? "verified" : developerId ? "missing" : "not-applicable";
  const installability = gatekeeperStatus === 0 ? "passed" : developerId ? "failed" : "not-checked";
  return { signature, notarization, installability, officialReady: signature === "verified" && notarization === "verified" && installability === "passed" };
}

export function classifyWindowsVerification({ status, statusMessage = "", packageCheckPassed = true }) {
  const signature = status === "Valid" ? "verified" : status === "NotSigned" ? "unsigned" : "invalid";
  const installability = packageCheckPassed ? "passed" : "failed";
  return { signature, notarization: "not-applicable", installability, officialReady: signature === "verified" && installability === "passed", statusMessage };
}

export function classifyLinuxVerification({ packageCheckPassed, detachedSignaturePassed, fingerprintMatches }) {
  const signature = detachedSignaturePassed
    ? fingerprintMatches === false ? "untrusted" : "verified"
    : "unsigned";
  const installability = packageCheckPassed ? "passed" : "failed";
  return {
    signature,
    notarization: "not-applicable",
    installability,
    officialReady: signature === "verified" && fingerprintMatches === true && installability === "passed",
  };
}

async function inspectMac() {
  const packageDirectories = (await readdir(packageRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && entry.name.includes("darwin") && !entry.name.includes("make"));
  const appDirectory = packageDirectories
    .map((entry) => path.join(packageRoot, entry.name, "Janus Studio.app"))
    .find(existsSync);
  if (!appDirectory) throw new Error(`No packaged macOS application found under ${packageRoot}`);

  const verify = command("codesign", ["--verify", "--deep", "--strict", "--verbose=4", appDirectory]);
  const details = command("codesign", ["--display", "--verbose=4", appDirectory]);
  const stapler = command("xcrun", ["stapler", "validate", appDirectory]);
  const gatekeeper = command("spctl", ["--assess", "--type", "execute", "--verbose=4", appDirectory]);
  return [{
    path: path.relative(repositoryRoot, appDirectory),
    kind: "macos-application",
    ...classifyMacVerification({
      codesignStatus: verify.status,
      codesignDetails: evidence(details),
      staplerStatus: stapler.status,
      gatekeeperStatus: gatekeeper.status,
    }),
    evidence: {
      codesign: evidence(verify) || evidence(details),
      notarization: evidence(stapler),
      gatekeeper: evidence(gatekeeper),
    },
  }];
}

async function inspectWindows() {
  const files = (await collectFiles(makeRoot)).filter((file) => file.toLowerCase().endsWith(".exe"));
  if (files.length === 0) throw new Error(`No Windows installer found under ${makeRoot}`);
  return files.map((file) => {
    const script = `$s=Get-AuthenticodeSignature -LiteralPath '${file.replaceAll("'", "''")}'; @{Status=$s.Status.ToString(); StatusMessage=$s.StatusMessage; SignerCertificate=if($s.SignerCertificate){$s.SignerCertificate.Subject}else{$null}} | ConvertTo-Json -Compress`;
    const result = command("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script]);
    let parsed = { Status: "UnknownError", StatusMessage: evidence(result), SignerCertificate: null };
    if (result.status === 0) {
      try { parsed = JSON.parse(result.stdout); } catch { /* preserved as an invalid result */ }
    }
    const header = readFileSync(file).subarray(0, 2).toString("ascii");
    const packageCheckPassed = header === "MZ";
    return {
      path: path.relative(makeRoot, file).replaceAll(path.sep, "/"),
      kind: "windows-installer",
      ...classifyWindowsVerification({ status: parsed.Status, statusMessage: parsed.StatusMessage, packageCheckPassed }),
      signer: parsed.SignerCertificate,
    };
  });
}

function validSignatureFingerprint(output) {
  const match = output.match(/\[GNUPG:\] VALIDSIG ([A-F0-9]{40,64})\b/i);
  return match?.[1]?.toUpperCase() ?? null;
}

async function inspectLinux() {
  const files = (await collectFiles(makeRoot)).filter((file) => /\.(deb|rpm)$/i.test(file));
  if (files.length === 0) throw new Error(`No Linux package found under ${makeRoot}`);
  const expectedFingerprint = process.env.LINUX_GPG_FINGERPRINT?.replaceAll(/\s/g, "").toUpperCase() || null;
  const publicKey = path.join(makeRoot, "LINUX-SIGNING-KEY.asc");
  const home = mkdtempSync(path.join(tmpdir(), "janus-studio-verify-gpg-"));
  try {
    if (existsSync(publicKey)) command("gpg", ["--batch", "--homedir", home, "--import", publicKey]);
    return files.map((file) => {
      const extension = path.extname(file).toLowerCase();
      const packageCheck = extension === ".deb"
        ? command("dpkg-deb", ["--info", file])
        : command("rpm", ["--checksig", file]);
      const signatureFile = `${file}.asc`;
      const signature = existsSync(signatureFile) && existsSync(publicKey)
        ? command("gpg", ["--batch", "--homedir", home, "--status-fd", "1", "--verify", signatureFile, file])
        : { status: 1, stdout: "", stderr: "Detached signature or public verification key is missing" };
      const fingerprint = validSignatureFingerprint(`${signature.stdout ?? ""}\n${signature.stderr ?? ""}`);
      const classified = classifyLinuxVerification({
        packageCheckPassed: packageCheck.status === 0,
        detachedSignaturePassed: signature.status === 0 && Boolean(fingerprint),
        fingerprintMatches: expectedFingerprint ? fingerprint === expectedFingerprint : null,
      });
      return {
        path: path.relative(makeRoot, file).replaceAll(path.sep, "/"),
        kind: extension === ".deb" ? "linux-deb" : "linux-rpm",
        ...classified,
        fingerprint,
        expectedFingerprintConfigured: Boolean(expectedFingerprint),
        evidence: { package: evidence(packageCheck), signature: evidence(signature) },
      };
    });
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

export function summarizeArtifactVerification(platform, artifacts) {
  const officialReady = artifacts.length > 0 && artifacts.every((artifact) => artifact.officialReady);
  return {
    signature: artifacts.every((artifact) => artifact.signature === "verified")
      ? "verified"
      : artifacts.some((artifact) => artifact.signature === "invalid" || artifact.signature === "untrusted")
        ? "invalid"
        : artifacts.some((artifact) => artifact.signature === "ad-hoc") ? "ad-hoc" : "unsigned",
    notarization: platform === "darwin"
      ? artifacts.every((artifact) => artifact.notarization === "verified")
        ? "verified"
        : artifacts.some((artifact) => artifact.signature === "verified") ? "missing" : "not-applicable"
      : "not-applicable",
    installability: artifacts.every((artifact) => artifact.installability === "passed")
      ? "passed"
      : artifacts.some((artifact) => artifact.installability === "failed") ? "failed" : "not-checked",
    officialReady,
  };
}

export async function inspectReleaseArtifacts() {
  const artifacts = process.platform === "darwin"
    ? await inspectMac()
    : process.platform === "win32" ? await inspectWindows() : await inspectLinux();
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    platform: process.platform,
    architecture: process.arch,
    overall: summarizeArtifactVerification(process.platform, artifacts),
    artifacts,
  };
  await mkdir(makeRoot, { recursive: true });
  const output = path.join(makeRoot, `release-verification-${process.platform}-${process.arch}.json`);
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return { output, report };
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  inspectReleaseArtifacts()
    .then(({ output, report }) => {
      console.log(`Release artifacts inspected: ${path.relative(repositoryRoot, output)} [${report.overall.officialReady ? "official-ready" : "test-build"}]`);
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
