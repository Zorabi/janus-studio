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
    queryTimeoutMs: z.number().int().min(500).max(3_600_000),
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
export const clipboardTextSchema = z.string().max(5_242_880);
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

export const queryRequestSchema = z.object({
  connectionId: connectionIdSchema,
  consoleId: z.string().trim().min(1).max(160),
  executionId: z.string().uuid(),
  query: z.string().trim().min(1).max(1_000_000),
  traversalSource: z.string().trim().min(1).max(160).optional(),
  bindings: z.record(z.string(), z.unknown()).optional(),
  recordHistory: z.boolean().optional().default(true),
  productionConfirmed: z.boolean().optional().default(false),
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

export const schemaJobIdSchema = z.string().uuid();
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
