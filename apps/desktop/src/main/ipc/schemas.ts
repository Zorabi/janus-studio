import { z } from "zod";

export const connectionInputSchema = z
  .object({
    id: z.string().uuid().optional(),
    name: z.string().trim().min(1).max(80),
    protocol: z.enum(["ws", "wss", "http", "https"]),
    host: z.string().trim().min(1).max(255),
    port: z.number().int().min(1).max(65_535),
    path: z.string().trim().min(1).max(255),
    username: z.string().max(255),
    password: z.string().max(4_096).optional(),
    environment: z.enum(["dev", "test", "prod"]).default("dev"),
    connectionReadOnly: z.boolean().default(false),
    clientMode: z.enum(["sessionless", "sessioned"]).default("sessionless"),
    traversalSource: z.string().trim().min(1).max(80),
    graphBinding: z.string().trim().min(1).max(80),
    connectTimeoutMs: z.number().int().min(500).max(120_000),
    queryTimeoutMs: z.number().int().min(500).max(86_400_000),
    tlsRejectUnauthorized: z.boolean().default(true),
    enableCompression: z.boolean().default(false),
    customHeaders: z.string().max(32_768).default("{}"),
  })
  .superRefine((input, context) => {
    if (
      input.clientMode === "sessioned" &&
      input.protocol !== "ws" &&
      input.protocol !== "wss"
    ) {
      context.addIssue({
        code: "custom",
        path: ["clientMode"],
        message: "Sessioned Client 仅支持 WS/WSS 协议",
      });
    }
    try {
      const headers = JSON.parse(input.customHeaders) as unknown;
      if (!headers || typeof headers !== "object" || Array.isArray(headers)) throw new Error();
      if (Object.values(headers).some((value) => typeof value !== "string")) throw new Error();
    } catch {
      context.addIssue({
        code: "custom",
        path: ["customHeaders"],
        message: "自定义请求头必须是仅包含字符串值的 JSON 对象",
      });
    }
  });

export const connectionIdSchema = z.string().uuid();
export const compatibilityRequestSchema = z.object({
  connectionId: connectionIdSchema,
  refresh: z.boolean().optional().default(false),
});
export const clipboardTextSchema = z.string().max(5_242_880);
const diagnosticLogLevelSchema = z.enum(["debug", "info", "warn", "error"]);
const diagnosticLogSourceSchema = z.enum([
  "application",
  "renderer",
  "ipc",
  "connection",
  "query",
  "schema",
  "transfer",
  "compatibility",
  "storage",
  "security",
]);
export const diagnosticLogListSchema = z.object({
  limit: z.number().int().min(1).max(500).optional(),
  levels: z.array(diagnosticLogLevelSchema).max(4).optional(),
  sources: z.array(diagnosticLogSourceSchema).max(10).optional(),
}).optional();
const diagnosticIncidentSchema = z.object({
  source: z.enum(["connection", "schema", "graphFactory", "task"]),
  title: z.string().trim().min(1).max(240),
  connectionName: z.string().trim().max(160).optional(),
  graphName: z.string().trim().max(160).optional(),
  stage: z.string().trim().max(160).optional(),
  message: z.string().max(16_384).optional(),
  occurredAt: z.string().max(64).refine(
    (value) => Number.isFinite(Date.parse(value)),
    "诊断事件时间必须是有效日期",
  ),
}).optional();
export const diagnosticPreviewSchema = z.object({
  limit: z.number().int().min(1).max(500).optional(),
  levels: z.array(diagnosticLogLevelSchema).max(4).optional(),
  sources: z.array(diagnosticLogSourceSchema).max(10).optional(),
  incident: diagnosticIncidentSchema,
}).optional();
export const diagnosticBundleSchema = z.object({
  limit: z.number().int().min(1).max(500).optional(),
  levels: z.array(diagnosticLogLevelSchema).min(1).max(4).optional(),
  sources: z.array(diagnosticLogSourceSchema).min(1).max(10).optional(),
  incident: diagnosticIncidentSchema,
  selection: z.object({
    summary: z.boolean(),
    tasks: z.boolean(),
    logs: z.boolean(),
  }).refine((value) => Object.values(value).some(Boolean), "至少选择一个诊断文件"),
});
export const historyIdSchema = z.string().uuid();
export const historyLimitSchema = z.number().int().min(1).max(2_000).optional();
const historyDateSchema = z.string().max(64).refine(
  (value) => Number.isFinite(Date.parse(value)),
  "历史日期必须是有效的日期时间",
);
export const historyListSchema = z.union([
  historyLimitSchema,
  z.object({
    limit: z.number().int().min(1).max(2_000).optional(),
    offset: z.number().int().min(0).max(10_000_000).optional(),
    connectionId: connectionIdSchema.optional(),
    statuses: z
      .array(z.enum(["success", "error", "cancelled", "truncated"]))
      .max(4)
      .optional(),
    createdFrom: historyDateSchema.optional(),
    createdTo: historyDateSchema.optional(),
  }),
]);

export const queryAssetIdSchema = z.string().uuid();
export const saveQueryAssetTagSchema = z.object({
  id: queryAssetIdSchema.optional(),
  name: z.string().trim().min(1).max(48),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
});
export const saveQueryAssetFolderSchema = z.object({
  id: queryAssetIdSchema.optional(),
  name: z.string().trim().min(1).max(80),
  parentId: z.union([queryAssetIdSchema, z.literal("")]).optional().default(""),
  sortOrder: z.number().int().min(-1_000_000).max(1_000_000).default(0),
});
const queryAssetTagIdsSchema = z.array(queryAssetIdSchema).max(64).transform((values) => [...new Set(values)]);
export const querySnippetListSchema = z.object({
  limit: z.number().int().min(1).max(1_000).optional(),
  offset: z.number().int().min(0).max(10_000_000).optional(),
  search: z.string().trim().max(200).optional(),
  folderId: z.union([queryAssetIdSchema, z.literal("")]).optional(),
  tagIds: queryAssetTagIdsSchema.optional(),
  starred: z.boolean().optional(),
}).optional();
export const saveQuerySnippetSchema = z.object({
  id: queryAssetIdSchema.optional(),
  name: z.string().trim().min(1).max(120),
  description: z.string().max(2_000),
  query: z.string().trim().min(1).max(1_000_000),
  bindingsText: z.string().max(64_000).refine((value) => {
    try {
      const parsed = JSON.parse(value) as unknown;
      return Boolean(parsed) && typeof parsed === "object" && !Array.isArray(parsed);
    } catch { return false; }
  }, "Snippet 参数必须是 JSON 对象"),
  connectionId: z.union([connectionIdSchema, z.literal("")]),
  graphName: z.string().trim().max(120),
  traversalSource: z.string().trim().max(120),
  folderId: z.union([queryAssetIdSchema, z.literal("")]),
  starred: z.boolean(),
  tagIds: queryAssetTagIdsSchema.optional().default([]),
});
export const queryHistoryMetadataListSchema = z.array(historyIdSchema).max(2_000).transform((values) => [...new Set(values)]);
export const saveQueryHistoryMetadataSchema = z.object({
  historyId: historyIdSchema,
  starred: z.boolean(),
  note: z.string().max(4_000),
  tagIds: queryAssetTagIdsSchema,
});
export const queryHistoryAssetListSchema = z.object({
  limit: z.number().int().min(1).max(500).optional(),
  offset: z.number().int().min(0).max(10_000_000).optional(),
  search: z.string().trim().max(200).optional(),
  connectionId: connectionIdSchema.optional(),
  statuses: z.array(z.enum(["success", "error", "cancelled", "truncated"])).max(4).optional(),
  createdFrom: historyDateSchema.optional(),
  createdTo: historyDateSchema.optional(),
  tagIds: queryAssetTagIdsSchema.optional(),
  starred: z.boolean().optional(),
}).optional();
export const saveQueryHistoryMetadataBatchSchema = z.array(saveQueryHistoryMetadataSchema).min(1).max(500);
export const historyIdsSchema = z.array(historyIdSchema).min(1).max(500).transform((values) => [...new Set(values)]);

export const queryRequestSchema = z.object({
  connectionId: connectionIdSchema,
  consoleId: z.string().trim().min(1).max(160),
  executionId: z.string().uuid(),
  query: z.string().trim().min(1).max(1_000_000),
  graphName: z.string().trim().max(160).optional(),
  traversalSource: z.string().trim().min(1).max(160).optional(),
  bindings: z.record(z.string(), z.unknown()).optional(),
  recordHistory: z.boolean().optional().default(true),
  productionConfirmed: z.boolean().optional().default(false),
  timeoutMs: z.number().int().min(500).max(86_400_000).optional(),
  serverCancellation: z.boolean().optional().default(false),
});

export const queryExportSchema = z.object({
  connectionId: connectionIdSchema,
  executionId: z.string().uuid(),
  query: z.string().trim().min(1).max(1_000_000),
  traversalSource: z.string().trim().min(1).max(160).optional(),
  bindings: z.record(z.string(), z.unknown()).optional(),
  suggestedName: z.string().trim().min(1).max(255),
  format: z.enum(["json", "jsonl"]),
});

export const queryCancelSchema = z.object({
  executionId: z.string().uuid(),
});

export const queryConsoleSchema = z.object({
  connectionId: connectionIdSchema,
  consoleId: z.string().trim().min(1).max(160),
});

export const saveDataFileSchema = z.object({
  suggestedName: z.string().trim().min(1).max(255),
  format: z.enum(["json", "jsonl", "csv"]),
  content: z.string().max(210_000_000),
});

export const saveResultFileSchema = z.object({
  suggestedName: z.string().trim().min(1).max(255),
  format: z.enum(["json", "jsonl", "csv"]),
  items: z.array(z.unknown()).max(10_000),
});

export const saveQueryFileSchema = z.object({
  suggestedName: z.string().trim().min(1).max(255),
  content: z.string().max(5_242_880),
});

export const saveSchemaFileSchema = z.object({
  suggestedName: z.string().trim().min(1).max(255),
  content: z.string().max(5_242_880),
});

export const saveGraphFileSchema = z.object({
  suggestedName: z.string().trim().min(1).max(255),
  format: z.enum(["png", "jpg", "svg", "json"]),
  content: z.string().max(60_000_000),
});

export const dockerContainerIdSchema = z.string().trim().min(1).max(160).regex(
  /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/,
  "Docker 容器名称或 ID 格式无效",
);
export const dockerTransferIdSchema = z.string().uuid();
export const finishDockerExportSchema = z.object({
  transferId: dockerTransferIdSchema,
  suggestedName: z.string().trim().min(1).max(255),
});

export const startGraphTransferSchema = z.object({
  connectionId: connectionIdSchema,
  action: z.enum(["import", "export", "purge"]),
  graphName: z.string().trim().min(1).max(120).regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/),
  graphBinding: z.string().trim().min(1).max(120).regex(/^[a-zA-Z_$][a-zA-Z0-9_$]*$/),
  graphAccess: z.enum(["configured", "binding"]),
  fileAccess: z.enum(["docker", "path"]),
  serverPath: z.string().trim().max(4_096).optional(),
  dockerContainerId: dockerContainerIdSchema.optional(),
  dockerTransferId: dockerTransferIdSchema.optional(),
  enableBatchLoading: z.boolean().optional().default(false),
  disableAutomaticSchema: z.boolean().optional().default(true),
  overwrite: z.boolean().optional().default(false),
  productionConfirmed: z.boolean().optional().default(false),
}).superRefine((value, context) => {
  if (value.action === "purge") return;
  if (value.fileAccess === "path" && !value.serverPath) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["serverPath"], message: "Server path is required" });
  }
  if (value.action === "import" && value.fileAccess === "docker" && !value.dockerTransferId) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["dockerTransferId"], message: "Staged Docker import is required" });
  }
  if (value.action === "export" && value.fileAccess === "docker" && !value.dockerContainerId) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["dockerContainerId"], message: "Docker container is required" });
  }
});

export const schemaJobIdSchema = z.string().uuid();
export const backgroundTaskIdSchema = z.string().uuid();
export const backgroundTaskLimitSchema = z.number().int().min(1).max(1_000).optional();
export const publishBackgroundTaskSchema = z.object({
  id: backgroundTaskIdSchema,
  kind: z.enum(["transfer", "maintenance"]),
  action: z.enum(["import", "export", "purge", "drop"]),
  title: z.string().trim().min(1).max(255),
  connectionId: connectionIdSchema,
  graphName: z.string().trim().min(1).max(255),
  status: z.enum(["running", "cancel_requested", "succeeded", "failed", "interrupted"]),
  stage: z.string().trim().min(1).max(80),
  message: z.string().max(32_768),
  progressCurrent: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  progressTotal: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  progressUnit: z.string().trim().min(1).max(40),
  cancellable: z.boolean(),
  retriable: z.boolean(),
});
export const runSchemaJobSchema = z.object({
  connectionId: connectionIdSchema,
  indexName: z.string().trim().min(1).max(255),
  action: z.string().trim().min(1).max(80),
  query: z.string().trim().min(1).max(1_000_000),
  queries: z.array(z.string().trim().min(1).max(60_000)).min(1).max(200).optional(),
  productionConfirmed: z.boolean().optional().default(false),
}).superRefine((value, context) => {
  const totalLength = value.queries?.reduce((total, query) => total + query.length, 0) ?? 0;
  if (totalLength > 5_000_000) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["queries"],
      message: "Schema batch payload is too large",
    });
  }
});
