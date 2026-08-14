import { z } from "zod";

const headerObjectSchema = z.record(z.string(), z.string());
const sensitiveHeaderPattern = /^(?:authorization|proxy-authorization|cookie|set-cookie|x-api-key|x-auth-token|x-access-token)$/i;
const forbiddenHeaderPattern = /^(?:host|connection|content-length|transfer-encoding|upgrade)$/i;

function addHeaderIssues(headers: Record<string, string>, context: z.RefinementCtx, path: string): void {
  for (const key of Object.keys(headers)) {
    if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(key) || forbiddenHeaderPattern.test(key)) {
      context.addIssue({ code: "custom", path: [path], message: `请求头 ${key} 不允许由连接配置覆盖` });
    }
  }
}

function parseHeaderObject(value: string): Record<string, string> {
  const parsed = JSON.parse(value) as unknown;
  return headerObjectSchema.parse(parsed);
}

export const authenticationProfileInputSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1).max(80),
  mode: z.enum(["basic", "janus-hmac", "bearer", "custom-headers"]),
  username: z.string().trim().max(255).default(""),
  headerName: z.string().trim().min(1).max(255).default("Authorization"),
  secret: z.string().max(16_384).optional(),
  sensitiveHeaders: z.string().max(32_768).optional(),
}).superRefine((input, context) => {
  if ((input.mode === "basic" || input.mode === "janus-hmac") && !input.username) {
    context.addIssue({ code: "custom", path: ["username"], message: "该认证方式需要账号" });
  }
  if (input.sensitiveHeaders !== undefined && input.sensitiveHeaders.trim()) {
    try { addHeaderIssues(parseHeaderObject(input.sensitiveHeaders), context, "sensitiveHeaders"); }
    catch { context.addIssue({ code: "custom", path: ["sensitiveHeaders"], message: "敏感请求头必须是仅包含字符串值的 JSON 对象" }); }
  }
  if (!input.id && input.mode !== "custom-headers" && !input.secret) {
    context.addIssue({ code: "custom", path: ["secret"], message: "新认证方案必须填写凭据" });
  }
  if (!input.id && input.mode === "custom-headers" && (!input.sensitiveHeaders || input.sensitiveHeaders.trim() === "{}")) {
    context.addIssue({ code: "custom", path: ["sensitiveHeaders"], message: "自定义 Header 方案至少需要一个加密请求头" });
  }
});
export const authenticationProfileIdSchema = z.string().uuid();

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
    tlsCaPath: z.string().trim().max(4096).default(""),
    tlsClientCertPath: z.string().trim().max(4096).default(""),
    tlsClientKeyPath: z.string().trim().max(4096).default(""),
    tlsClientKeyPassphrase: z.string().max(4096).optional(),
    proxyMode: z.enum(["direct", "system", "manual"]).default("direct"),
    proxyUrl: z.string().trim().max(4096).default(""),
    proxyHost: z.string().trim().max(255).default(""),
    proxyPort: z.number().int().min(1).max(65_535).default(8080),
    proxyBypass: z.string().trim().max(8192).default(""),
    proxyUsername: z.string().trim().max(255).default(""),
    proxyPassword: z.string().max(4096).optional(),
    authProfileId: z.union([z.string().uuid(), z.literal("")]).default(""),
    sensitiveHeaders: z.string().max(32_768).optional(),
    sshEnabled: z.boolean().default(false),
    sshHost: z.string().trim().max(255).default(""),
    sshPort: z.number().int().min(1).max(65_535).default(22),
    sshUsername: z.string().trim().max(255).default(""),
    sshAuthMode: z.enum(["password", "private-key", "agent"]).default("private-key"),
    sshPrivateKeyPath: z.string().trim().max(4096).default(""),
    sshAgentPath: z.string().trim().max(4096).default(""),
    sshHostKeyFingerprint: z.string().trim().max(255).default(""),
    sshPassword: z.string().max(4096).optional(),
    sshPrivateKeyPassphrase: z.string().max(4096).optional(),
    enableCompression: z.boolean().default(false),
    customHeaders: z.string().max(32_768).default("{}"),
    groupName: z.string().trim().max(80).default(""),
    accentColor: z.enum(["#c8ff55", "#83bcff", "#efb45e", "#ff746a", "#b8a3ff", "#69dfb0"]).default("#c8ff55"),
    tags: z.array(z.string().trim().min(1).max(40)).max(12).default([]),
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
    if (Boolean(input.tlsClientCertPath) !== Boolean(input.tlsClientKeyPath)) {
      context.addIssue({
        code: "custom",
        path: [input.tlsClientCertPath ? "tlsClientKeyPath" : "tlsClientCertPath"],
        message: "mTLS 客户端证书和私钥必须同时配置",
      });
    }
    if (input.tlsClientKeyPassphrase && !input.tlsClientKeyPath) {
      context.addIssue({
        code: "custom",
        path: ["tlsClientKeyPassphrase"],
        message: "配置客户端私钥后才能保存私钥口令",
      });
    }
    if (input.proxyMode === "manual" && !input.proxyUrl && !input.proxyHost) {
      context.addIssue({
        code: "custom",
        path: ["proxyHost"],
        message: "手动代理需要填写代理 URL 或主机",
      });
    }
    if (input.proxyUrl) {
      try {
        const value = input.proxyUrl.includes("://") ? input.proxyUrl : `http://${input.proxyUrl}`;
        const url = new URL(value);
        if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error();
        if (url.username || url.password) {
          context.addIssue({
            code: "custom",
            path: ["proxyUrl"],
            message: "代理 URL 不得包含凭据，请使用代理账号和密码字段",
          });
        }
      } catch {
        context.addIssue({
          code: "custom",
          path: ["proxyUrl"],
          message: "代理 URL 必须使用 http:// 或 https://",
        });
      }
    }
    if (input.sshEnabled) {
      if (!input.sshHost) context.addIssue({ code: "custom", path: ["sshHost"], message: "启用 SSH Tunnel 后必须填写跳板机地址" });
      if (!input.sshUsername) context.addIssue({ code: "custom", path: ["sshUsername"], message: "启用 SSH Tunnel 后必须填写 SSH 账号" });
      if (!/^SHA256:[A-Za-z0-9+/]{43}=?$/.test(input.sshHostKeyFingerprint)) {
        context.addIssue({ code: "custom", path: ["sshHostKeyFingerprint"], message: "必须填写完整的 SHA256 SSH 主机密钥指纹" });
      }
      if (input.sshAuthMode === "private-key" && !input.sshPrivateKeyPath) {
        context.addIssue({ code: "custom", path: ["sshPrivateKeyPath"], message: "私钥认证需要选择 SSH 私钥" });
      }
      if (input.proxyMode !== "direct") {
        context.addIssue({ code: "custom", path: ["proxyMode"], message: "当前版本的 SSH Tunnel 不能与 Gremlin 代理叠加" });
      }
    }
    try {
      const headers = parseHeaderObject(input.customHeaders);
      addHeaderIssues(headers, context, "customHeaders");
      const sensitiveKey = Object.keys(headers).find((key) => sensitiveHeaderPattern.test(key));
      if (sensitiveKey) {
        context.addIssue({ code: "custom", path: ["customHeaders"], message: `请求头 ${sensitiveKey} 属于敏感值，请移入加密请求头` });
      }
    } catch {
      context.addIssue({
        code: "custom",
        path: ["customHeaders"],
        message: "自定义请求头必须是仅包含字符串值的 JSON 对象",
      });
    }
    if (input.sensitiveHeaders !== undefined && input.sensitiveHeaders.trim()) {
      try { addHeaderIssues(parseHeaderObject(input.sensitiveHeaders), context, "sensitiveHeaders"); }
      catch { context.addIssue({ code: "custom", path: ["sensitiveHeaders"], message: "加密请求头必须是仅包含字符串值的 JSON 对象" }); }
    }
  });

export const connectionIdSchema = z.string().uuid();
export const saveConnectionArchiveSchema = z.object({
  suggestedName: z.string().trim().min(1).max(255),
  content: z.string().max(2 * 1024 * 1024),
});
export const tlsFileKindSchema = z.enum(["ca", "certificate", "private-key"]);
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
export const diagnosticRecordIdSchema = z.string().uuid();
export const diagnosticRecordLimitSchema = z.number().int().min(1).max(200).optional();
export const diagnosticRecordStatusSchema = z.enum(["unread", "acknowledged", "resolved"]);
export const saveDiagnosticRecordSchema = z.object({
  origin: z.enum(["live", "bundle"]),
  sourceName: z.string().max(255).optional(),
  incident: diagnosticIncidentSchema,
  report: z.object({
    generatedAt: z.string().max(64),
    signalsScanned: z.number().int().min(0).max(100_000),
    findings: z.array(z.object({
      code: z.enum(["instance-id-conflict", "graphson-serialization", "evaluation-timeout", "elasticsearch-shard-limit", "schema-name-conflict", "index-lifecycle", "configured-graph-factory", "capability-probe"]),
      severity: z.enum(["critical", "warning", "info"]),
      confidence: z.enum(["confirmed", "likely", "hint"]),
      evidence: z.array(z.object({ source: z.string().max(255), excerpt: z.string().max(500) })).max(3),
    })).max(20),
  }),
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
  kind: z.enum(["transfer", "maintenance", "quality"]),
  action: z.enum(["import", "export", "purge", "drop", "quality-check"]),
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

const qualityName = z.string().trim().min(1).max(160);
const qualityRuleSchema = z.object({
  id: z.string().uuid(), name: qualityName,
  kind: z.enum(["isolated-vertex", "duplicate-vertex", "required-property", "property-domain", "edge-endpoint", "degree-range", "distribution"]),
  enabled: z.boolean(), severity: z.enum(["info", "warning", "error"]),
  vertexLabel: z.string().trim().max(160).optional(), vertexLabels: z.array(qualityName).max(100).optional(),
  ignoredEdgeLabels: z.array(qualityName).max(100).optional(), propertyKeys: z.array(qualityName).max(20).optional(), propertyKey: qualityName.optional(),
  ignoreMissing: z.boolean().optional(), constraint: z.enum(["not-blank", "number-range", "enum"]).optional(),
  minimum: z.number().finite().optional(), maximum: z.number().finite().optional(), allowedValues: z.array(z.string().max(500)).max(200).optional(),
  edgeLabel: z.string().trim().max(160).optional(), outVertexLabels: z.array(qualityName).max(100).optional(), inVertexLabels: z.array(qualityName).max(100).optional(),
  direction: z.enum(["in", "out", "both"]).optional(), minDegree: z.number().int().min(0).optional(), maxDegree: z.number().int().min(0).optional(),
  includeVertices: z.boolean().optional(), includeEdges: z.boolean().optional(),
}).superRefine((rule, context) => {
  const require = (condition: boolean, path: string, message: string) => { if (!condition) context.addIssue({ code: z.ZodIssueCode.custom, path: [path], message }); };
  if (["duplicate-vertex", "required-property", "property-domain", "degree-range"].includes(rule.kind)) require(Boolean(rule.vertexLabel), "vertexLabel", "该规则必须选择顶点标签");
  if (rule.kind === "duplicate-vertex") require(Boolean(rule.propertyKeys?.length && rule.propertyKeys.length <= 5), "propertyKeys", "重复候选需要选择 1 至 5 个属性");
  if (rule.kind === "required-property") require(Boolean(rule.propertyKeys?.length), "propertyKeys", "必填属性规则至少选择一个属性");
  if (rule.kind === "property-domain") require(Boolean(rule.propertyKey && rule.constraint), "propertyKey", "属性域规则需要属性与约束");
  if (rule.kind === "edge-endpoint") { require(Boolean(rule.edgeLabel), "edgeLabel", "边端点规则必须选择边标签"); require(Boolean(rule.outVertexLabels?.length && rule.inVertexLabels?.length), "outVertexLabels", "边端点规则必须配置起终点标签"); }
  if (rule.kind === "degree-range") require((rule.minDegree ?? 0) <= (rule.maxDegree ?? Number.MAX_SAFE_INTEGER), "maxDegree", "最大度数不能小于最小度数");
});

export const qualityRuleSetIdSchema = z.string().uuid();
export const saveQualityRuleSetSchema = z.object({
  id: qualityRuleSetIdSchema.optional(), name: qualityName, description: z.string().max(2_000), connectionId: connectionIdSchema,
  graphName: qualityName, graphBinding: z.string().trim().min(1).max(160), graphAccess: z.enum(["binding", "configured"]),
  rules: z.array(qualityRuleSchema).min(1).max(100),
});
export const startQualityRunSchema = z.object({
  ruleSetId: qualityRuleSetIdSchema, mode: z.enum(["bounded", "full"]),
  scanLimit: z.number().int().min(1_000).max(50_000).optional(), sampleLimit: z.number().int().min(1).max(200).optional(),
  timeoutMs: z.number().int().min(1_000).max(86_400_000).optional(), productionConfirmed: z.boolean().optional(), confirmedGraphName: z.string().max(160).optional(),
});
export const qualityRunIdSchema = z.string().uuid();
export const qualityRunListSchema = z.object({
  connectionId: connectionIdSchema.optional(), ruleSetId: qualityRuleSetIdSchema.optional(),
  statuses: z.array(z.enum(["running", "cancel_requested", "succeeded", "failed", "interrupted"])).max(5).optional(),
  limit: z.number().int().min(1).max(200).optional(),
}).optional();
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
