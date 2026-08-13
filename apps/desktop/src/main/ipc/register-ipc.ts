import { app, clipboard, ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from "electron";
import { release } from "node:os";
import { ConnectionService } from "../services/connection-service";
import { FileService } from "../services/file-service";
import { QueryService } from "../services/query-service";
import { HistoryRepository } from "../storage/history-repository";
import { CredentialVault } from "../security/credential-vault";
import { SchemaJobService } from "../services/schema-job-service";
import { BackgroundTaskService } from "../services/background-task-service";
import { CompatibilityService } from "../services/compatibility-service";
import { GraphTransferService } from "../services/graph-transfer-service";
import { QueryAssetRepository } from "../storage/query-asset-repository";
import { StructuredLogger } from "../diagnostics/structured-logger";
import { redactDiagnosticValue } from "../diagnostics/redactor";
import type { DiagnosticIncidentContext, DiagnosticLogListInput } from "@janusgraph/domain";
import {
  buildDiagnosticPreviewFiles,
  diagnosticPreviewContainsExcludedContent,
} from "@janusgraph/application";
import {
  backgroundTaskIdSchema,
  backgroundTaskLimitSchema,
  connectionIdSchema,
  connectionInputSchema,
  clipboardTextSchema,
  compatibilityRequestSchema,
  dockerContainerIdSchema,
  dockerTransferIdSchema,
  finishDockerExportSchema,
  historyIdSchema,
  historyIdsSchema,
  historyListSchema,
  queryCancelSchema,
  queryConsoleSchema,
  queryRequestSchema,
  queryExportSchema,
  publishBackgroundTaskSchema,
  queryAssetIdSchema,
  queryHistoryMetadataListSchema,
  queryHistoryAssetListSchema,
  querySnippetListSchema,
  saveDataFileSchema,
  saveGraphFileSchema,
  saveQueryAssetFolderSchema,
  saveQueryAssetTagSchema,
  saveQueryHistoryMetadataSchema,
  saveQueryHistoryMetadataBatchSchema,
  saveQuerySnippetSchema,
  saveResultFileSchema,
  saveQueryFileSchema,
  saveSchemaFileSchema,
  runSchemaJobSchema,
  schemaJobIdSchema,
  startGraphTransferSchema,
  diagnosticLogListSchema,
  diagnosticPreviewSchema,
  diagnosticBundleSchema,
} from "./schemas";

type RegisterIpcOptions = {
  window: BrowserWindow;
  connectionService: ConnectionService;
  queryService: QueryService;
  historyRepository: HistoryRepository;
  fileService: FileService;
  credentialVault: CredentialVault;
  schemaJobService: SchemaJobService;
  backgroundTaskService: BackgroundTaskService;
  compatibilityService: CompatibilityService;
  graphTransferService: GraphTransferService;
  queryAssetRepository: QueryAssetRepository;
  diagnosticLogger: StructuredLogger;
};

function assertTrustedSender(event: IpcMainInvokeEvent, window: BrowserWindow): void {
  if (event.sender !== window.webContents) {
    throw new Error("拒绝来自未知窗口的 IPC 请求");
  }
}

function diagnosticSnapshot(
  logger: StructuredLogger,
  tasks: BackgroundTaskService,
  input?: {
    limit?: number;
    levels?: DiagnosticLogListInput["levels"];
    sources?: DiagnosticLogListInput["sources"];
    incident?: DiagnosticIncidentContext;
  },
) {
  const logInput = input
    ? { limit: input.limit, levels: input.levels, sources: input.sources }
    : undefined;
  return {
    generatedAt: new Date().toISOString(),
    runtime: {
      appVersion: app.getVersion(),
      electronVersion: process.versions.electron ?? "unknown",
      nodeVersion: process.versions.node,
      platform: process.platform,
      osRelease: release(),
      architecture: process.arch,
    },
    tasks: redactDiagnosticValue(tasks.list(50)) as ReturnType<BackgroundTaskService["list"]>,
    logs: logger.list(logInput),
    incident: input?.incident
      ? redactDiagnosticValue(input.incident) as DiagnosticIncidentContext
      : undefined,
  };
}

async function invokeWithDiagnostics<T>(
  logger: StructuredLogger,
  channel: string,
  source: "connection" | "query" | "schema" | "transfer" | "compatibility",
  operation: () => T | Promise<T>,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    const errorSummary = error instanceof Error
      ? { name: error.name }
      : { type: typeof error };
    logger.error(source, "ipc.invoke-failed", `IPC operation failed: ${channel}`, errorSummary, { channel });
    throw error;
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
  backgroundTaskService,
  compatibilityService,
  graphTransferService,
  queryAssetRepository,
  diagnosticLogger,
}: RegisterIpcOptions): void {
  ipcMain.handle("runtime:platform", (event) => {
    assertTrustedSender(event, window);
    return process.platform;
  });

  ipcMain.handle("runtime:write-clipboard", (event, rawText: unknown) => {
    assertTrustedSender(event, window);
    clipboard.writeText(clipboardTextSchema.parse(rawText));
  });

  ipcMain.handle("diagnostics:runtime", (event) => {
    assertTrustedSender(event, window);
    return {
      appVersion: app.getVersion(),
      electronVersion: process.versions.electron ?? "unknown",
      nodeVersion: process.versions.node,
      platform: process.platform,
      osRelease: release(),
      architecture: process.arch,
    };
  });

  ipcMain.handle("diagnostics:logs:list", (event, rawInput: unknown) => {
    assertTrustedSender(event, window);
    return diagnosticLogger.list(diagnosticLogListSchema.parse(rawInput));
  });

  ipcMain.handle("diagnostics:preview", (event, rawInput: unknown) => {
    assertTrustedSender(event, window);
    const input = diagnosticPreviewSchema.parse(rawInput);
    return diagnosticSnapshot(diagnosticLogger, backgroundTaskService, input);
  });

  ipcMain.handle("diagnostics:bundle:export", async (event, rawInput: unknown) => {
    assertTrustedSender(event, window);
    const input = diagnosticBundleSchema.parse(rawInput);
    const snapshot = diagnosticSnapshot(diagnosticLogger, backgroundTaskService, input);
    const files = buildDiagnosticPreviewFiles(snapshot, input.selection);
    if (diagnosticPreviewContainsExcludedContent(files)) {
      throw new Error("诊断包安全检查未通过，已阻止写入");
    }
    const readme = [
      "Janus Studio 问题诊断包",
      "",
      `生成时间：${snapshot.generatedAt}`,
      "",
      "此诊断包用于排查连接、Schema、动态图和长任务异常。",
      "密码、Token、认证 Header、私钥、查询正文和字符串绑定已固定排除。",
      "发送前仍建议在 Janus Studio 的问题诊断页面逐项预览内容。",
      "",
      `包含文件：${files.map((file) => file.name).join("、")}`,
    ].join("\n");
    const date = snapshot.generatedAt.slice(0, 10).replaceAll("-", "");
    return fileService.saveDiagnosticBundle(
      [...files.map((file) => ({ name: file.name, content: file.content })), { name: "README.txt", content: readme }],
      `janus-studio-diagnostics-${date}.zip`,
    );
  });

  ipcMain.handle("connections:list", (event) => {
    assertTrustedSender(event, window);
    return connectionService.list();
  });

  ipcMain.handle("connections:save", async (event, rawInput: unknown) => {
    assertTrustedSender(event, window);
    return invokeWithDiagnostics(diagnosticLogger, "connections:save", "connection", () =>
      connectionService.save(connectionInputSchema.parse(rawInput)));
  });

  ipcMain.handle("connections:remove", async (event, rawId: unknown) => {
    assertTrustedSender(event, window);
    await connectionService.remove(connectionIdSchema.parse(rawId));
  });

  ipcMain.handle("connections:test", async (event, rawInput: unknown) => {
    assertTrustedSender(event, window);
    return invokeWithDiagnostics(diagnosticLogger, "connections:test", "connection", () =>
      connectionService.test(connectionInputSchema.parse(rawInput)));
  });

  ipcMain.handle("compatibility:get", async (event, rawInput: unknown) => {
    assertTrustedSender(event, window);
    const input = compatibilityRequestSchema.parse(rawInput);
    return invokeWithDiagnostics(diagnosticLogger, "compatibility:get", "compatibility", () =>
      compatibilityService.get(input.connectionId, input.refresh));
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

  ipcMain.handle("history:list", (event, rawInput: unknown) => {
    assertTrustedSender(event, window);
    return historyRepository.list(historyListSchema.parse(rawInput) ?? 200);
  });

  ipcMain.handle("history:remove", (event, rawId: unknown) => {
    assertTrustedSender(event, window);
    historyRepository.remove(historyIdSchema.parse(rawId));
  });
  ipcMain.handle("history:remove-many", (event, rawIds: unknown) => {
    assertTrustedSender(event, window);
    historyRepository.removeMany(historyIdsSchema.parse(rawIds));
  });

  ipcMain.handle("history:clear", (event) => {
    assertTrustedSender(event, window);
    historyRepository.clear();
  });

  ipcMain.handle("query-assets:tags:list", (event) => {
    assertTrustedSender(event, window);
    return queryAssetRepository.listTags();
  });
  ipcMain.handle("query-assets:tags:save", (event, rawInput: unknown) => {
    assertTrustedSender(event, window);
    return queryAssetRepository.saveTag(saveQueryAssetTagSchema.parse(rawInput));
  });
  ipcMain.handle("query-assets:tags:remove", (event, rawId: unknown) => {
    assertTrustedSender(event, window);
    queryAssetRepository.removeTag(queryAssetIdSchema.parse(rawId));
  });
  ipcMain.handle("query-assets:folders:list", (event) => {
    assertTrustedSender(event, window);
    return queryAssetRepository.listFolders();
  });
  ipcMain.handle("query-assets:folders:save", (event, rawInput: unknown) => {
    assertTrustedSender(event, window);
    return queryAssetRepository.saveFolder(saveQueryAssetFolderSchema.parse(rawInput));
  });
  ipcMain.handle("query-assets:folders:remove", (event, rawId: unknown) => {
    assertTrustedSender(event, window);
    queryAssetRepository.removeFolder(queryAssetIdSchema.parse(rawId));
  });
  ipcMain.handle("query-assets:snippets:list", (event, rawInput: unknown) => {
    assertTrustedSender(event, window);
    return queryAssetRepository.listSnippets(querySnippetListSchema.parse(rawInput));
  });
  ipcMain.handle("query-assets:snippets:save", (event, rawInput: unknown) => {
    assertTrustedSender(event, window);
    return queryAssetRepository.saveSnippet(saveQuerySnippetSchema.parse(rawInput));
  });
  ipcMain.handle("query-assets:snippets:remove", (event, rawId: unknown) => {
    assertTrustedSender(event, window);
    queryAssetRepository.removeSnippet(queryAssetIdSchema.parse(rawId));
  });
  ipcMain.handle("query-assets:history:list", (event, rawIds: unknown) => {
    assertTrustedSender(event, window);
    return queryAssetRepository.historyMetadata(queryHistoryMetadataListSchema.parse(rawIds));
  });
  ipcMain.handle("query-assets:history:save", (event, rawInput: unknown) => {
    assertTrustedSender(event, window);
    return queryAssetRepository.saveHistoryMetadata(saveQueryHistoryMetadataSchema.parse(rawInput));
  });
  ipcMain.handle("query-assets:history:page", (event, rawInput: unknown) => {
    assertTrustedSender(event, window);
    return queryAssetRepository.listHistory(queryHistoryAssetListSchema.parse(rawInput));
  });
  ipcMain.handle("query-assets:history:save-batch", (event, rawInput: unknown) => {
    assertTrustedSender(event, window);
    return queryAssetRepository.saveHistoryMetadataBatch(saveQueryHistoryMetadataBatchSchema.parse(rawInput));
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

  ipcMain.handle("files:pick-schema", async (event) => {
    assertTrustedSender(event, window);
    return fileService.pickSchemaFile();
  });

  ipcMain.handle("files:save-schema", async (event, rawInput: unknown) => {
    assertTrustedSender(event, window);
    return fileService.saveSchemaFile(saveSchemaFileSchema.parse(rawInput));
  });

  ipcMain.handle("data-transfers:docker-status", async (event) => {
    assertTrustedSender(event, window);
    return fileService.dockerStatus();
  });

  ipcMain.handle("data-transfers:stage-docker-import", async (event, rawContainerId: unknown) => {
    assertTrustedSender(event, window);
    return fileService.stageDockerImport(dockerContainerIdSchema.parse(rawContainerId));
  });

  ipcMain.handle("data-transfers:prepare-docker-export", async (event, rawContainerId: unknown) => {
    assertTrustedSender(event, window);
    return fileService.prepareDockerExport(dockerContainerIdSchema.parse(rawContainerId));
  });

  ipcMain.handle("data-transfers:finish-docker-export", async (event, rawInput: unknown) => {
    assertTrustedSender(event, window);
    const input = finishDockerExportSchema.parse(rawInput);
    return fileService.finishDockerExport(input.transferId, input.suggestedName);
  });

  ipcMain.handle("data-transfers:cleanup-docker", async (event, rawTransferId: unknown) => {
    assertTrustedSender(event, window);
    return fileService.cleanupDockerTransfer(dockerTransferIdSchema.parse(rawTransferId));
  });

  ipcMain.handle("data-transfers:start", (event, rawInput: unknown) => {
    assertTrustedSender(event, window);
    return invokeWithDiagnostics(diagnosticLogger, "data-transfers:start", "transfer", () =>
      graphTransferService.start(startGraphTransferSchema.parse(rawInput)));
  });

  ipcMain.handle("data-transfers:cancel", async (event, rawTaskId: unknown) => {
    assertTrustedSender(event, window);
    return graphTransferService.cancel(backgroundTaskIdSchema.parse(rawTaskId));
  });

  ipcMain.handle("data-transfers:retry", (event, rawTaskId: unknown) => {
    assertTrustedSender(event, window);
    return invokeWithDiagnostics(diagnosticLogger, "data-transfers:retry", "transfer", () =>
      graphTransferService.retry(backgroundTaskIdSchema.parse(rawTaskId)));
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
    return invokeWithDiagnostics(diagnosticLogger, "schema-jobs:run", "schema", () =>
      schemaJobService.run(runSchemaJobSchema.parse(rawInput)));
  });

  ipcMain.handle("schema-jobs:cancel", async (event, rawConnectionId: unknown) => {
    assertTrustedSender(event, window);
    return schemaJobService.cancel(connectionIdSchema.parse(rawConnectionId));
  });

  ipcMain.handle("schema-jobs:retry", async (event, rawId: unknown) => {
    assertTrustedSender(event, window);
    return invokeWithDiagnostics(diagnosticLogger, "schema-jobs:retry", "schema", () =>
      schemaJobService.retry(schemaJobIdSchema.parse(rawId)));
  });

  ipcMain.handle("schema-jobs:dismiss", (event, rawId: unknown) => {
    assertTrustedSender(event, window);
    schemaJobService.dismiss(schemaJobIdSchema.parse(rawId));
  });

  ipcMain.handle("tasks:list", (event, rawLimit: unknown) => {
    assertTrustedSender(event, window);
    return backgroundTaskService.list(backgroundTaskLimitSchema.parse(rawLimit));
  });

  ipcMain.handle("tasks:publish", (event, rawInput: unknown) => {
    assertTrustedSender(event, window);
    return backgroundTaskService.publish(publishBackgroundTaskSchema.parse(rawInput));
  });

  ipcMain.handle("tasks:acknowledge", (event, rawId: unknown) => {
    assertTrustedSender(event, window);
    const id = rawId == null ? undefined : backgroundTaskIdSchema.parse(rawId);
    backgroundTaskService.acknowledge(id);
  });

  ipcMain.handle("tasks:dismiss", (event, rawId: unknown) => {
    assertTrustedSender(event, window);
    backgroundTaskService.dismiss(backgroundTaskIdSchema.parse(rawId));
  });
}
