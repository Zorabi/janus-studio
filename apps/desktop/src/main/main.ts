import {
  app,
  BrowserWindow,
  Menu,
  session,
  type MenuItemConstructorOptions,
} from "electron";
import { join } from "node:path";
import { ConnectionRepository } from "./storage/connection-repository";
import { openApplicationDatabase } from "./storage/database";
import { CredentialVault } from "./security/credential-vault";
import { ConnectionService } from "./services/connection-service";
import { GremlinService } from "./services/gremlin-service";
import { FileService } from "./services/file-service";
import { QueryService } from "./services/query-service";
import { registerIpcHandlers } from "./ipc/register-ipc";
import { SchemaJobRepository } from "./storage/schema-job-repository";
import { BackgroundTaskRepository } from "./storage/background-task-repository";
import { SchemaJobService } from "./services/schema-job-service";
import { BackgroundTaskService } from "./services/background-task-service";
import { CompatibilityService } from "./services/compatibility-service";
import { HistoryRepository } from "./storage/history-repository";
import { GraphTransferRepository } from "./storage/graph-transfer-repository";
import { GraphTransferService } from "./services/graph-transfer-service";
import { QueryAssetRepository } from "./storage/query-asset-repository";
import { UpdateSourceType, updateElectronApp } from "update-electron-app";
import { StructuredLogger } from "./diagnostics/structured-logger";
import { DiagnosticRecordRepository } from "./storage/diagnostic-record-repository";
import { AuthenticationProfileRepository } from "./storage/authentication-profile-repository";
import { AuthenticationProfileService } from "./services/authentication-profile-service";

declare const __UPDATE_REPOSITORY__: string;
declare const __UPDATE_BASE_URL__: string;

let mainWindow: BrowserWindow | null = null;
let activeGremlinService: GremlinService | null = null;
const diagnosticLogger = new StructuredLogger(500);

function installApplicationMenu(window: BrowserWindow): void {
  const openPreferences: MenuItemConstructorOptions = {
    label: "Preferences…",
    accelerator: "CommandOrControl+,",
    click: () => window.webContents.send("app:navigate", "settings"),
  };
  const editMenu: MenuItemConstructorOptions = {
    label: "Edit",
    submenu: [
      { role: "undo" },
      { role: "redo" },
      { type: "separator" },
      { role: "cut" },
      { role: "copy" },
      { role: "paste" },
      { role: "selectAll" },
    ],
  };
  const viewMenu: MenuItemConstructorOptions = {
    label: "View",
    submenu: [
      {
        role: "reload",
        accelerator: "CommandOrControl+Shift+R",
      },
      ...(MAIN_WINDOW_VITE_DEV_SERVER_URL
        ? ([{ role: "toggleDevTools" }, { type: "separator" }] satisfies MenuItemConstructorOptions[])
        : []),
      { role: "resetZoom" },
      { role: "zoomIn" },
      { role: "zoomOut" },
      { type: "separator" },
      { role: "togglefullscreen" },
    ],
  };
  const windowMenu: MenuItemConstructorOptions = {
    label: "Window",
    submenu: [{ role: "minimize" }, { role: "zoom" }, { role: "close" }],
  };
  const helpMenu: MenuItemConstructorOptions = {
    role: "help",
    submenu: [],
  };
  const template: MenuItemConstructorOptions[] =
    process.platform === "darwin"
      ? [
          {
            label: app.name,
            submenu: [
              { role: "about" },
              { type: "separator" },
              openPreferences,
              { type: "separator" },
              { role: "services" },
              { type: "separator" },
              { role: "hide" },
              { role: "hideOthers" },
              { role: "unhide" },
              { type: "separator" },
              { role: "quit" },
            ],
          },
          { label: "File", submenu: [{ role: "close" }] },
          editMenu,
          viewMenu,
          windowMenu,
          helpMenu,
        ]
      : [
          {
            label: "File",
            submenu: [openPreferences, { type: "separator" }, { role: "quit" }],
          },
          editMenu,
          viewMenu,
          windowMenu,
          helpMenu,
        ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 960,
    minHeight: 700,
    backgroundColor: "#080a09",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    webPreferences: {
      preload: join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event, url) => {
    const allowed =
      url.startsWith("file://") ||
      (MAIN_WINDOW_VITE_DEV_SERVER_URL &&
        url.startsWith(MAIN_WINDOW_VITE_DEV_SERVER_URL));
    if (!allowed) event.preventDefault();
  });
  window.webContents.on("render-process-gone", (_event, details) => {
    diagnosticLogger.error(
      "renderer",
      "renderer.process-gone",
      "Renderer process terminated",
      undefined,
      { reason: details.reason, exitCode: details.exitCode },
    );
  });
  window.webContents.on("did-fail-load", (_event, errorCode, errorDescription) => {
    diagnosticLogger.error(
      "renderer",
      "renderer.load-failed",
      "Renderer failed to load",
      new Error(errorDescription),
      { errorCode },
    );
  });

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    void window.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    void window.loadFile(
      join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
  }

  return window;
}

app.whenReady().then(async () => {
  diagnosticLogger.info("application", "application.ready", "Janus Studio is ready", {
    appVersion: app.getVersion(),
    platform: process.platform,
    architecture: process.arch,
  });
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });

  if (app.isPackaged && (process.platform === "darwin" || process.platform === "win32")) {
    if (__UPDATE_BASE_URL__) {
      updateElectronApp({
        updateSource: { type: UpdateSourceType.StaticStorage, baseUrl: __UPDATE_BASE_URL__ },
        updateInterval: "30 minutes",
      });
    } else if (__UPDATE_REPOSITORY__) {
      updateElectronApp({
        updateSource: {
          type: UpdateSourceType.ElectronPublicUpdateService,
          repo: __UPDATE_REPOSITORY__,
        },
        updateInterval: "30 minutes",
      });
    }
  }

  const database = openApplicationDatabase(
    join(app.getPath("userData"), "janusgraph-desktop.sqlite"),
  );
  const repository = new ConnectionRepository(database);
  const historyRepository = new HistoryRepository(database);
  const schemaJobRepository = new SchemaJobRepository(database);
  const backgroundTaskRepository = new BackgroundTaskRepository(database);
  const graphTransferRepository = new GraphTransferRepository(database);
  const queryAssetRepository = new QueryAssetRepository(database);
  const diagnosticRecordRepository = new DiagnosticRecordRepository(database);
  const authenticationProfileRepository = new AuthenticationProfileRepository(database);
  const forceLocalCredentialVault =
    process.env.JANUS_STUDIO_FORCE_LOCAL_CREDENTIAL_VAULT === "1" ||
    process.platform === "darwin";
  const credentialVault = new CredentialVault(
    join(app.getPath("userData"), "credential-vault.key"),
    forceLocalCredentialVault,
  );
  const gremlinService = new GremlinService((endpoint) =>
    session.defaultSession.resolveProxy(endpoint),
  );
  activeGremlinService = gremlinService;
  const authenticationProfileService = new AuthenticationProfileService(
    authenticationProfileRepository,
    credentialVault,
  );
  const connectionService = new ConnectionService(
    repository,
    credentialVault,
    gremlinService,
    authenticationProfileService,
  );
  await connectionService.migrateLegacySensitiveHeaders();

  mainWindow = createWindow();
  installApplicationMenu(mainWindow);
  const fileService = new FileService(mainWindow);
  const queryService = new QueryService(
    connectionService,
    gremlinService,
    historyRepository,
    fileService,
    diagnosticLogger,
  );
  const schemaJobService = new SchemaJobService(
    schemaJobRepository,
    connectionService,
    queryService,
    backgroundTaskRepository,
  );
  const backgroundTaskService = new BackgroundTaskService(
    backgroundTaskRepository,
    schemaJobRepository,
    connectionService,
  );
  const compatibilityService = new CompatibilityService(connectionService, queryService);
  const graphTransferService = new GraphTransferService(
    backgroundTaskRepository,
    graphTransferRepository,
    connectionService,
    queryService,
    fileService,
    compatibilityService,
  );
  registerIpcHandlers({
    window: mainWindow,
    connectionService,
    queryService,
    historyRepository,
    fileService,
    credentialVault,
    schemaJobService,
    backgroundTaskService,
    compatibilityService,
    graphTransferService,
    queryAssetRepository,
    diagnosticLogger,
    diagnosticRecordRepository,
    authenticationProfileService,
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  diagnosticLogger.info("application", "application.quitting", "Janus Studio is quitting");
  void activeGremlinService?.closeAll();
});

process.on("uncaughtExceptionMonitor", (error, origin) => {
  diagnosticLogger.error(
    "application",
    "application.uncaught-exception",
    "An uncaught main-process exception was observed",
    error,
    { origin },
  );
});
