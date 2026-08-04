import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from "electron";
import { ConnectionService } from "../services/connection-service";
import { FileService } from "../services/file-service";
import { QueryService } from "../services/query-service";
import { HistoryRepository } from "../storage/history-repository";
import { CredentialVault } from "../security/credential-vault";
import { SchemaJobService } from "../services/schema-job-service";
import {
  connectionIdSchema,
  connectionInputSchema,
  historyIdSchema,
  historyLimitSchema,
  queryCancelSchema,
  queryConsoleSchema,
  queryRequestSchema,
  queryExportSchema,
  saveDataFileSchema,
  saveGraphFileSchema,
  saveResultFileSchema,
  saveQueryFileSchema,
  runSchemaJobSchema,
  schemaJobIdSchema,
} from "./schemas";

type RegisterIpcOptions = {
  window: BrowserWindow;
  connectionService: ConnectionService;
  queryService: QueryService;
  historyRepository: HistoryRepository;
  fileService: FileService;
  credentialVault: CredentialVault;
  schemaJobService: SchemaJobService;
};

function assertTrustedSender(event: IpcMainInvokeEvent, window: BrowserWindow): void {
  if (event.sender !== window.webContents) {
    throw new Error("拒绝来自未知窗口的 IPC 请求");
  }
}

export function registerIpcHandlers({
  window,
  connectionService,
  queryService,
  historyRepository,
  fileService,
  credentialVault,
  schemaJobService,
}: RegisterIpcOptions): void {
  ipcMain.handle("runtime:platform", (event) => {
    assertTrustedSender(event, window);
    return process.platform;
  });

  ipcMain.handle("connections:list", (event) => {
    assertTrustedSender(event, window);
    return connectionService.list();
  });

  ipcMain.handle("connections:save", async (event, rawInput: unknown) => {
    assertTrustedSender(event, window);
    return connectionService.save(connectionInputSchema.parse(rawInput));
  });

  ipcMain.handle("connections:remove", async (event, rawId: unknown) => {
    assertTrustedSender(event, window);
    await connectionService.remove(connectionIdSchema.parse(rawId));
  });

  ipcMain.handle("connections:test", async (event, rawInput: unknown) => {
    assertTrustedSender(event, window);
    return connectionService.test(connectionInputSchema.parse(rawInput));
  });

  ipcMain.handle("queries:execute", async (event, rawRequest: unknown) => {
    assertTrustedSender(event, window);
    return queryService.execute(queryRequestSchema.parse(rawRequest));
  });

  ipcMain.handle("queries:export", async (event, rawRequest: unknown) => {
    assertTrustedSender(event, window);
    return queryService.export(queryExportSchema.parse(rawRequest));
  });

  ipcMain.handle("queries:cancel", async (event, rawRequest: unknown) => {
    assertTrustedSender(event, window);
    const request = queryCancelSchema.parse(rawRequest);
    return queryService.cancel(request.executionId);
  });

  ipcMain.handle("queries:close-console", async (event, rawRequest: unknown) => {
    assertTrustedSender(event, window);
    const request = queryConsoleSchema.parse(rawRequest);
    await queryService.closeConsole(request.connectionId, request.consoleId);
  });

  ipcMain.handle("history:list", (event, rawLimit: unknown) => {
    assertTrustedSender(event, window);
    return historyRepository.list(historyLimitSchema.parse(rawLimit) ?? 200);
  });

  ipcMain.handle("history:remove", (event, rawId: unknown) => {
    assertTrustedSender(event, window);
    historyRepository.remove(historyIdSchema.parse(rawId));
  });

  ipcMain.handle("history:clear", (event) => {
    assertTrustedSender(event, window);
    historyRepository.clear();
  });

  ipcMain.handle("files:pick-data", async (event) => {
    assertTrustedSender(event, window);
    return fileService.pickDataFile();
  });

  ipcMain.handle("files:save-data", async (event, rawInput: unknown) => {
    assertTrustedSender(event, window);
    return fileService.saveDataFile(saveDataFileSchema.parse(rawInput));
  });

  ipcMain.handle("files:save-result", async (event, rawInput: unknown) => {
    assertTrustedSender(event, window);
    return fileService.saveResultFile(saveResultFileSchema.parse(rawInput));
  });

  ipcMain.handle("files:save-graph", async (event, rawInput: unknown) => {
    assertTrustedSender(event, window);
    return fileService.saveGraphFile(saveGraphFileSchema.parse(rawInput));
  });

  ipcMain.handle("files:pick-query", async (event) => {
    assertTrustedSender(event, window);
    return fileService.pickQueryFile();
  });

  ipcMain.handle("files:save-query", async (event, rawInput: unknown) => {
    assertTrustedSender(event, window);
    return fileService.saveQueryFile(saveQueryFileSchema.parse(rawInput));
  });

  ipcMain.handle("security:status", async (event) => {
    assertTrustedSender(event, window);
    return credentialVault.status();
  });

  ipcMain.handle("schema-jobs:list", (event, rawConnectionId: unknown) => {
    assertTrustedSender(event, window);
    const connectionId = rawConnectionId == null ? undefined : connectionIdSchema.parse(rawConnectionId);
    return schemaJobService.list(connectionId);
  });

  ipcMain.handle("schema-jobs:run", async (event, rawInput: unknown) => {
    assertTrustedSender(event, window);
    return schemaJobService.run(runSchemaJobSchema.parse(rawInput));
  });

  ipcMain.handle("schema-jobs:retry", async (event, rawId: unknown) => {
    assertTrustedSender(event, window);
    return schemaJobService.retry(schemaJobIdSchema.parse(rawId));
  });
}
