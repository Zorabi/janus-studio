import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const expectedVersion = JSON.parse(readFileSync(join(repositoryRoot, "apps", "desktop", "package.json"), "utf8")).version;
const outDirectory = join(repositoryRoot, "apps", "desktop", "out");
const packageDirectory = readdirSync(outDirectory, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && !entry.name.includes("make"))
  .map((entry) => join(outDirectory, entry.name))
  .find((path) => basename(path).includes(process.platform));

assert.ok(packageDirectory, `No packaged application found for ${process.platform}`);

const macApplication = process.platform === "darwin"
  ? join(packageDirectory, "Janus Studio.app")
  : undefined;

if (macApplication) {
  const signature = spawnSync(
    "codesign",
    ["--verify", "--deep", "--strict", "--verbose=4", macApplication],
    { encoding: "utf8" },
  );
  assert.equal(
    signature.status,
    0,
    `Packaged macOS application has an invalid signature.\n${signature.stdout}${signature.stderr}`,
  );
}

const executable = macApplication
  ? join(macApplication, "Contents", "MacOS", "Janus Studio")
  : process.platform === "win32"
    ? join(packageDirectory, "Janus Studio.exe")
    : join(packageDirectory, "janus-studio");

const profileDirectory = mkdtempSync(join(tmpdir(), "janus-studio-e2e-"));
const port = 9_337;
const applicationArgs = [
  `--user-data-dir=${profileDirectory}`,
  `--remote-debugging-port=${port}`,
  ...(process.platform === "linux" ? ["--no-sandbox"] : []),
];
const command = process.platform === "linux" ? "xvfb-run" : executable;
const args = process.platform === "linux" ? ["-a", executable, ...applicationArgs] : applicationArgs;
const child = spawn(command, args, {
  stdio: ["ignore", "pipe", "pipe"],
  env: { ...process.env, JANUS_STUDIO_FORCE_LOCAL_CREDENTIAL_VAULT: "1" },
});
let diagnostics = "";
child.stdout.on("data", (chunk) => { diagnostics += chunk.toString(); });
child.stderr.on("data", (chunk) => { diagnostics += chunk.toString(); });

async function pollTargets() {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      const targets = await response.json();
      const page = targets.find((target) => target.type === "page" && !target.url.startsWith("devtools://"));
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch {
      // Electron is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Packaged app did not expose its page within 30 seconds.\n${diagnostics}`);
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
      if (message.error || message.result?.exceptionDetails) {
        reject(new Error(JSON.stringify(message.error ?? message.result.exceptionDetails)));
      } else {
        resolve(message.result.result.value);
      }
    };
    socket.send(JSON.stringify({
      id: 1,
      method: "Runtime.evaluate",
      params: { expression, awaitPromise: true, returnByValue: true },
    }));
  });
  socket.close();
  return result;
}

try {
  const page = await pollTargets();
  const audit = await evaluate(page, `(async () => {
    const deadline = Date.now() + 20000;
    while ((!window.janusGraphDesktop || !document.querySelector(".app-shell")) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!window.janusGraphDesktop) throw new Error("Desktop bridge was not exposed");
    if (!document.querySelector(".app-shell")) throw new Error("Renderer shell did not mount");
    const saved = await window.janusGraphDesktop.connections.save({
      name: "Packaged E2E",
      protocol: "ws",
      host: "127.0.0.1",
      port: 8182,
      path: "/gremlin",
      username: "qa",
      password: "e2e-only-password",
      clientMode: "sessionless",
      traversalSource: "g",
      graphBinding: "graph",
      connectTimeoutMs: 1000,
      queryTimeoutMs: 2000,
      tlsRejectUnauthorized: true,
      enableCompression: false,
      customHeaders: "{}"
    });
    const connections = await window.janusGraphDesktop.connections.list();
    const security = await window.janusGraphDesktop.security.status();
    const runtime = await window.janusGraphDesktop.diagnostics.runtime();
    const schemaJobs = await window.janusGraphDesktop.schemaJobs.list(saved.id);
    return {
      title: document.title,
      shell: Boolean(document.querySelector(".app-shell")),
      connectionId: saved.id,
      savedPassword: saved.hasPassword,
      connectionCount: connections.length,
      securityMode: security.mode,
      appVersion: runtime.appVersion,
      schemaJobCount: schemaJobs.length,
    };
  })()`);
  assert.deepEqual(
    {
      title: audit.title,
      shell: audit.shell,
      savedPassword: audit.savedPassword,
      connectionCount: audit.connectionCount,
      schemaJobCount: audit.schemaJobCount,
    },
    { title: "Janus Studio", shell: true, savedPassword: true, connectionCount: 1, schemaJobCount: 0 },
  );
  assert.equal(audit.securityMode, "local-fallback");
  assert.equal(audit.appVersion, expectedVersion, "Packaged runtime version does not match apps/desktop/package.json");

  const contextMenuAudit = await evaluate(page, `(async () => {
    const deadline = Date.now() + 20000;
    while (!document.querySelector(".gremlin-editor .view-lines") && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    const editor = document.querySelector(".gremlin-editor .view-lines");
    if (!editor) throw new Error("Gremlin editor did not mount");
    const editorBounds = editor.getBoundingClientRect();
    editor.dispatchEvent(new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      button: 2,
      buttons: 2,
      clientX: Math.max(editorBounds.left + 20, editorBounds.right - 8),
      clientY: Math.max(editorBounds.top + 20, editorBounds.bottom - 8)
    }));
    while (!document.querySelector(".gremlin-context-menu") && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const menu = document.querySelector(".gremlin-context-menu");
    if (!menu) throw new Error("Custom Gremlin context menu did not open");
    const bounds = menu.getBoundingClientRect();
    const text = menu.textContent ?? "";
    const nativeMenuVisible = [...document.querySelectorAll(".monaco-menu-container, .monaco-menu")]
      .some((candidate) => candidate.getBoundingClientRect().width > 0);
    const formatButton = [...menu.querySelectorAll("button")]
      .find((button) => /格式化 Gremlin|Format Gremlin/.test(button.textContent ?? ""));
    if (!formatButton) throw new Error("Format action is missing from the custom context menu");
    menu.querySelector(".gremlin-context-menu-close")?.click();
    await new Promise((resolve) => setTimeout(resolve, 50));

    document.querySelector(".query-tab-more")?.click();
    await new Promise((resolve) => setTimeout(resolve, 50));
    const tabMenu = document.querySelector(".query-tab-menu");
    if (!tabMenu) throw new Error("Query tab menu did not open");
    const tabMenuBounds = tabMenu.getBoundingClientRect();
    const tabMenuText = tabMenu.textContent ?? "";
    window.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 50));

    const utilityButtons = [...document.querySelectorAll(".editor-utilities button")];
    const parameterButton = utilityButtons.find((button) => /参数|Parameters/.test(button.textContent ?? ""));
    parameterButton?.click();
    await new Promise((resolve) => setTimeout(resolve, 50));
    const parameters = document.querySelector(".parameters-popover");
    if (!parameters) throw new Error("Parameters popover did not open");
    const parametersBounds = parameters.getBoundingClientRect();
    const parameterTextareaBounds = parameters.querySelector("textarea")?.getBoundingClientRect();
    parameters.querySelector("header button")?.click();
    await new Promise((resolve) => setTimeout(resolve, 50));

    const favoriteButton = utilityButtons.find((button) => /收藏|Favorites/.test(button.textContent ?? ""));
    favoriteButton?.click();
    await new Promise((resolve) => setTimeout(resolve, 50));
    const favoriteNameInput = document.querySelector(".saved-query-create input");
    return {
      text,
      withinViewport: bounds.left >= 0 && bounds.top >= 0 && bounds.right <= innerWidth && bounds.bottom <= innerHeight,
      nativeMenuVisible,
      formatActionPresent: Boolean(formatButton),
      tabMenuText,
      tabMenuWithinViewport: tabMenuBounds.left >= 0 && tabMenuBounds.top >= 0 && tabMenuBounds.right <= innerWidth && tabMenuBounds.bottom <= innerHeight,
      parametersCompact: parametersBounds.height <= 440 && (parameterTextareaBounds?.height ?? 999) <= 220,
      favoriteNameInput: Boolean(favoriteNameInput)
    };
  })()`);
  assert.match(contextMenuAudit.text, /运行当前查询|Run current query/);
  assert.match(contextMenuAudit.text, /格式化 Gremlin|Format Gremlin/);
  assert.match(contextMenuAudit.text, /Explain/);
  assert.match(contextMenuAudit.text, /Profile/);
  assert.match(contextMenuAudit.text, /查找并替换|Find and replace/);
  assert.equal(contextMenuAudit.withinViewport, true, "Custom context menu escaped the application viewport");
  assert.equal(contextMenuAudit.nativeMenuVisible, false, "Monaco's native context menu is still visible");
  assert.equal(contextMenuAudit.formatActionPresent, true, "Context-menu formatting action is missing");
  assert.match(contextMenuAudit.tabMenuText, /保存为 Gremlin 文件|Save as Gremlin file/);
  assert.equal(contextMenuAudit.tabMenuWithinViewport, true, "Query tab menu escaped the viewport");
  assert.equal(contextMenuAudit.parametersCompact, true, "Parameters popover is oversized");
  assert.equal(contextMenuAudit.favoriteNameInput, true, "Favorite naming input is missing");
  console.log(`Packaged smoke test passed on ${process.platform}/${process.arch} (${audit.securityMode}).`);
} finally {
  child.kill("SIGTERM");
  await new Promise((resolve) => setTimeout(resolve, 500));
  if (!child.killed) child.kill("SIGKILL");
  rmSync(profileDirectory, { recursive: true, force: true });
}
