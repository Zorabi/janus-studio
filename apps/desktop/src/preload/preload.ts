import type { DesktopApi } from "@janusgraph/domain";
import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";

const desktopApi: DesktopApi = {
  runtime: {
    platform: () => ipcRenderer.invoke("runtime:platform"),
    onNavigate: (listener) => {
      const handler = (_event: IpcRendererEvent, destination: "settings") =>
        listener(destination);
      ipcRenderer.on("app:navigate", handler);
      return () => ipcRenderer.removeListener("app:navigate", handler);
    },
  },
  connections: {
    list: () => ipcRenderer.invoke("connections:list"),
    save: (input) => ipcRenderer.invoke("connections:save", input),
    remove: (id) => ipcRenderer.invoke("connections:remove", id),
    test: (input) => ipcRenderer.invoke("connections:test", input),
  },
  queries: {
    execute: (input) => ipcRenderer.invoke("queries:execute", input),
    cancel: (input) => ipcRenderer.invoke("queries:cancel", input),
    closeConsole: (input) => ipcRenderer.invoke("queries:close-console", input),
    export: (input) => ipcRenderer.invoke("queries:export", input),
  },
  history: {
    list: (limit) => ipcRenderer.invoke("history:list", limit),
    remove: (id) => ipcRenderer.invoke("history:remove", id),
    clear: () => ipcRenderer.invoke("history:clear"),
  },
  files: {
    pickDataFile: () => ipcRenderer.invoke("files:pick-data"),
    saveDataFile: (input) => ipcRenderer.invoke("files:save-data", input),
    saveResultFile: (input) => ipcRenderer.invoke("files:save-result", input),
    pickQueryFile: () => ipcRenderer.invoke("files:pick-query"),
    saveQueryFile: (input) => ipcRenderer.invoke("files:save-query", input),
  },
  security: {
    status: () => ipcRenderer.invoke("security:status"),
  },
  schemaJobs: {
    list: (connectionId) => ipcRenderer.invoke("schema-jobs:list", connectionId),
    run: (input) => ipcRenderer.invoke("schema-jobs:run", input),
    retry: (id) => ipcRenderer.invoke("schema-jobs:retry", id),
  },
};

contextBridge.exposeInMainWorld("janusGraphDesktop", desktopApi);
