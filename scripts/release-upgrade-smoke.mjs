import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputRoot = path.join(repositoryRoot, "apps", "desktop", "out");
const makeRoot = path.join(outputRoot, "make");
const reportPath = path.join(makeRoot, `upgrade-rollback-smoke-${process.platform}-${process.arch}.json`);

function resolveExecutable(candidate) {
  if (process.platform === "darwin" && candidate.endsWith(".app")) {
    return path.join(candidate, "Contents", "MacOS", "Janus Studio");
  }
  return candidate;
}

function currentExecutable() {
  const packageDirectory = readdirSync(outputRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.includes("make"))
    .map((entry) => path.join(outputRoot, entry.name))
    .find((directory) => path.basename(directory).includes(process.platform) && path.basename(directory).includes(process.arch));
  if (!packageDirectory) return null;
  if (process.platform === "darwin") return path.join(packageDirectory, "Janus Studio.app", "Contents", "MacOS", "Janus Studio");
  if (process.platform === "win32") return path.join(packageDirectory, "Janus Studio.exe");
  return path.join(packageDirectory, "janus-studio");
}

async function evaluate(webSocketUrl, expression) {
  const socket = new WebSocket(webSocketUrl);
  await new Promise((resolve, reject) => {
    socket.onopen = resolve;
    socket.onerror = reject;
  });
  const result = await new Promise((resolve, reject) => {
    socket.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.id !== 1) return;
      if (message.error || message.result?.exceptionDetails) reject(new Error(JSON.stringify(message.error ?? message.result.exceptionDetails)));
      else resolve(message.result.result.value);
    };
    socket.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression, awaitPromise: true, returnByValue: true } }));
  });
  socket.close();
  return result;
}

async function launchAndAudit(executable, profileDirectory, phase) {
  const port = 10_000 + Math.floor(Math.random() * 30_000);
  const applicationArgs = [`--user-data-dir=${profileDirectory}`, `--remote-debugging-port=${port}`, ...(process.platform === "linux" ? ["--no-sandbox"] : [])];
  const command = process.platform === "linux" ? "xvfb-run" : executable;
  const args = process.platform === "linux" ? ["-a", executable, ...applicationArgs] : applicationArgs;
  const child = spawn(command, args, {
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, JANUS_STUDIO_FORCE_LOCAL_CREDENTIAL_VAULT: "1" },
  });
  let diagnostics = "";
  child.stdout.on("data", (chunk) => { diagnostics += chunk.toString(); });
  child.stderr.on("data", (chunk) => { diagnostics += chunk.toString(); });
  try {
    const deadline = Date.now() + 45_000;
    let page;
    while (Date.now() < deadline) {
      try {
        const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json());
        page = targets.find((target) => target.type === "page" && !target.url.startsWith("devtools://"));
        if (page?.webSocketDebuggerUrl) break;
      } catch { /* application is still starting */ }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    if (!page?.webSocketDebuggerUrl) throw new Error(`Application did not start during ${phase}.\n${diagnostics.slice(-4_000)}`);
    return await evaluate(page.webSocketDebuggerUrl, phase === "seed"
      ? `(async()=>{const d=Date.now()+20000;while(!window.janusGraphDesktop&&Date.now()<d)await new Promise(r=>setTimeout(r,100));const c=await window.janusGraphDesktop.connections.save({name:"Upgrade rollback fixture",protocol:"ws",host:"127.0.0.1",port:9,path:"/gremlin",username:"",password:"isolated-smoke-only",clientMode:"sessionless",traversalSource:"g",graphBinding:"graph",connectTimeoutMs:500,queryTimeoutMs:500,tlsRejectUnauthorized:true,enableCompression:false,customHeaders:"{}"});const l=await window.janusGraphDesktop.connections.list();const r=await window.janusGraphDesktop.diagnostics.runtime();return {version:r.appVersion,count:l.length,hasPassword:c.hasPassword}})()`
      : `(async()=>{const d=Date.now()+20000;while(!window.janusGraphDesktop&&Date.now()<d)await new Promise(r=>setTimeout(r,100));const l=await window.janusGraphDesktop.connections.list();const r=await window.janusGraphDesktop.diagnostics.runtime();return {version:r.appVersion,count:l.length,name:l[0]?.name,hasPassword:l[0]?.hasPassword}})()`);
  } finally {
    child.kill("SIGTERM");
    await new Promise((resolve) => setTimeout(resolve, 500));
    if (!child.killed) child.kill("SIGKILL");
  }
}

export async function runUpgradeRollbackSmoke() {
  await mkdir(makeRoot, { recursive: true });
  const previousCandidate = process.env.JANUS_STUDIO_PREVIOUS_APP;
  const currentCandidate = process.env.JANUS_STUDIO_CURRENT_APP || currentExecutable();
  if (process.env.JANUS_STUDIO_RUN_UPGRADE_SMOKE !== "1" || !previousCandidate || !currentCandidate) {
    const report = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      platform: process.platform,
      architecture: process.arch,
      status: "not-configured",
      reason: "Set JANUS_STUDIO_RUN_UPGRADE_SMOKE=1 and provide JANUS_STUDIO_PREVIOUS_APP; no installer or user profile was changed.",
    };
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    return report;
  }

  const previous = resolveExecutable(path.resolve(previousCandidate));
  const current = resolveExecutable(path.resolve(currentCandidate));
  if (!existsSync(previous) || !existsSync(current)) throw new Error("Upgrade smoke executable does not exist");
  const workspace = mkdtempSync(path.join(tmpdir(), "janus-studio-upgrade-smoke-"));
  const profile = path.join(workspace, "profile");
  const rollbackBackup = path.join(workspace, "rollback-backup");
  try {
    const seeded = await launchAndAudit(previous, profile, "seed");
    assert.equal(seeded.count, 1);
    assert.equal(seeded.hasPassword, true);
    cpSync(profile, rollbackBackup, { recursive: true });

    const upgraded = await launchAndAudit(current, profile, "upgrade");
    assert.equal(upgraded.count, 1);
    assert.equal(upgraded.name, "Upgrade rollback fixture");
    assert.equal(upgraded.hasPassword, true);

    rmSync(profile, { recursive: true, force: true });
    cpSync(rollbackBackup, profile, { recursive: true });
    const rolledBack = await launchAndAudit(previous, profile, "rollback");
    assert.equal(rolledBack.count, 1);
    assert.equal(rolledBack.name, "Upgrade rollback fixture");
    assert.equal(rolledBack.hasPassword, true);

    const report = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      platform: process.platform,
      architecture: process.arch,
      status: "passed",
      strategy: "isolated-profile-backup-restore",
      versions: { previous: seeded.version, current: upgraded.version, rollback: rolledBack.version },
      assertions: ["previous profile seeded", "current version migrated and read the profile", "restored backup reopened with previous version"],
    };
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    return report;
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  runUpgradeRollbackSmoke()
    .then((report) => console.log(`Upgrade/rollback smoke: ${report.status}`))
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
