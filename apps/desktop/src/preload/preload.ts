import type { DesktopApi } from "@janusgraph/domain";
import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";

const desktopApi: DesktopApi = {
  runtime: {
    platform: () => ipcRenderer.invoke("runtime:platform"),
    writeClipboard: (text) => ipcRenderer.invoke("runtime:write-clipboard", text),
    onNavigate: (listener) => {
      const handler = (_event: IpcRendererEvent, destination: "settings") =>
        listener(destination);
      ipcRenderer.on("app:navigate", handler);
      return () => ipcRenderer.removeListener("app:navigate", handler);
    },
  },
  diagnostics: {
    runtime: () => ipcRenderer.invoke("diagnostics:runtime"),
    listLogs: (input) => ipcRenderer.invoke("diagnostics:logs:list", input),
    preview: (input) => ipcRenderer.invoke("diagnostics:preview", input),
    exportBundle: (input) => ipcRenderer.invoke("diagnostics:bundle:export", input),
    inspectBundle: () => ipcRenderer.invoke("diagnostics:bundle:inspect"),
    listRecords: (limit) => ipcRenderer.invoke("diagnostics:records:list", limit),
    saveRecord: (input) => ipcRenderer.invoke("diagnostics:records:save", input),
    setRecordStatus: (id, status) => ipcRenderer.invoke("diagnostics:records:status", { id, status }),
    removeRecord: (id) => ipcRenderer.invoke("diagnostics:records:remove", id),
  },
  connections: {
    list: () => ipcRenderer.invoke("connections:list"),
    save: (input) => ipcRenderer.invoke("connections:save", input),
    remove: (id) => ipcRenderer.invoke("connections:remove", id),
    test: (input) => ipcRenderer.invoke("connections:test", input),
    onSshTunnelChanged: (listener) => {
      const handler = (_event: IpcRendererEvent, connectionId: string, snapshot: Parameters<typeof listener>[1]) => listener(connectionId, snapshot);
      ipcRenderer.on("connections:ssh-tunnel-changed", handler);
      return () => ipcRenderer.removeListener("connections:ssh-tunnel-changed", handler);
    },
  },
  authProfiles: {
    list: () => ipcRenderer.invoke("auth-profiles:list"),
    save: (input) => ipcRenderer.invoke("auth-profiles:save", input),
    remove: (id) => ipcRenderer.invoke("auth-profiles:remove", id),
  },
  compatibility: {
    get: (connectionId, refresh) => ipcRenderer.invoke("compatibility:get", { connectionId, refresh }),
  },
  queries: {
    execute: (input) => ipcRenderer.invoke("queries:execute", input),
    cancel: (input) => ipcRenderer.invoke("queries:cancel", input),
    closeConsole: (input) => ipcRenderer.invoke("queries:close-console", input),
    export: (input) => ipcRenderer.invoke("queries:export", input),
  },
  history: {
    list: (input) => ipcRenderer.invoke("history:list", input),
    remove: (id) => ipcRenderer.invoke("history:remove", id),
    removeMany: (ids) => ipcRenderer.invoke("history:remove-many", ids),
    clear: () => ipcRenderer.invoke("history:clear"),
  },
  queryAssets: {
    listTags: () => ipcRenderer.invoke("query-assets:tags:list"),
    saveTag: (input) => ipcRenderer.invoke("query-assets:tags:save", input),
    removeTag: (id) => ipcRenderer.invoke("query-assets:tags:remove", id),
    listFolders: () => ipcRenderer.invoke("query-assets:folders:list"),
    saveFolder: (input) => ipcRenderer.invoke("query-assets:folders:save", input),
    removeFolder: (id) => ipcRenderer.invoke("query-assets:folders:remove", id),
    listSnippets: (input) => ipcRenderer.invoke("query-assets:snippets:list", input),
    saveSnippet: (input) => ipcRenderer.invoke("query-assets:snippets:save", input),
    removeSnippet: (id) => ipcRenderer.invoke("query-assets:snippets:remove", id),
    historyMetadata: (historyIds) => ipcRenderer.invoke("query-assets:history:list", historyIds),
    saveHistoryMetadata: (input) => ipcRenderer.invoke("query-assets:history:save", input),
    listHistory: (input) => ipcRenderer.invoke("query-assets:history:page", input),
    saveHistoryMetadataBatch: (inputs) => ipcRenderer.invoke("query-assets:history:save-batch", inputs),
  },
  files: {
    pickTlsFile: (kind) => ipcRenderer.invoke("files:pick-tls", kind),
    pickDataFile: () => ipcRenderer.invoke("files:pick-data"),
    saveDataFile: (input) => ipcRenderer.invoke("files:save-data", input),
    saveResultFile: (input) => ipcRenderer.invoke("files:save-result", input),
    saveGraphFile: (input) => ipcRenderer.invoke("files:save-graph", input),
    pickQueryFile: () => ipcRenderer.invoke("files:pick-query"),
    saveQueryFile: (input) => ipcRenderer.invoke("files:save-query", input),
    pickSchemaFile: () => ipcRenderer.invoke("files:pick-schema"),
    saveSchemaFile: (input) => ipcRenderer.invoke("files:save-schema", input),
    pickConnectionArchive: () => ipcRenderer.invoke("files:pick-connection-archive"),
    saveConnectionArchive: (input) => ipcRenderer.invoke("files:save-connection-archive", input),
  },
  dataTransfers: {
    dockerStatus: () => ipcRenderer.invoke("data-transfers:docker-status"),
    stageDockerImport: (containerId) => ipcRenderer.invoke("data-transfers:stage-docker-import", containerId),
    prepareDockerExport: (containerId) => ipcRenderer.invoke("data-transfers:prepare-docker-export", containerId),
    finishDockerExport: (transferId, suggestedName) => ipcRenderer.invoke("data-transfers:finish-docker-export", { transferId, suggestedName }),
    cleanupDockerTransfer: (transferId) => ipcRenderer.invoke("data-transfers:cleanup-docker", transferId),
    start: (input) => ipcRenderer.invoke("data-transfers:start", input),
    cancel: (taskId) => ipcRenderer.invoke("data-transfers:cancel", taskId),
    retry: (taskId) => ipcRenderer.invoke("data-transfers:retry", taskId),
  },
  security: {
    status: () => ipcRenderer.invoke("security:status"),
  },
  schemaJobs: {
    list: (connectionId) => ipcRenderer.invoke("schema-jobs:list", connectionId),
    run: (input) => ipcRenderer.invoke("schema-jobs:run", input),
    cancel: (connectionId) => ipcRenderer.invoke("schema-jobs:cancel", connectionId),
    retry: (id) => ipcRenderer.invoke("schema-jobs:retry", id),
    dismiss: (id) => ipcRenderer.invoke("schema-jobs:dismiss", id),
  },
  tasks: {
    list: (limit) => ipcRenderer.invoke("tasks:list", limit),
    publish: (input) => ipcRenderer.invoke("tasks:publish", input),
    acknowledge: (id) => ipcRenderer.invoke("tasks:acknowledge", id),
    dismiss: (id) => ipcRenderer.invoke("tasks:dismiss", id),
  },
};

contextBridge.exposeInMainWorld("janusGraphDesktop", desktopApi);
