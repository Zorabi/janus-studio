import {
  isMutationQuery,
  normalizeManagementConsoleText,
  normalizeTraversalConsoleText,
} from "@janusgraph/application";
import type { QueryExecutionResult, QueryExportRequest, QueryExportResult, QueryRequest } from "@janusgraph/domain";
import { ConnectionService } from "./connection-service";
import { GremlinService } from "./gremlin-service";
import { HistoryRepository } from "../storage/history-repository";
import { FileService } from "./file-service";
import { StructuredLogger } from "../diagnostics/structured-logger";

function collectStringValues(value: unknown, output: string[] = [], seen = new WeakSet<object>()): string[] {
  if (typeof value === "string") {
    output.push(value);
    return output;
  }
  if (!value || typeof value !== "object" || seen.has(value)) return output;
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) collectStringValues(item, output, seen);
  } else {
    for (const item of Object.values(value)) collectStringValues(item, output, seen);
  }
  return output;
}

export class QueryService {
  constructor(
    private readonly connections: ConnectionService,
    private readonly gremlin: GremlinService,
    private readonly history: HistoryRepository,
    private readonly files: FileService,
    private readonly logger?: StructuredLogger,
  ) {}

  async execute(request: QueryRequest): Promise<QueryExecutionResult> {
    const storedProfile = this.connections.profile(request.connectionId);
    const profile = request.traversalSource
      ? { ...storedProfile, traversalSource: request.traversalSource }
      : storedProfile;
    if (profile.connectionReadOnly && isMutationQuery(request.query)) {
      throw new Error("连接级只读保护阻止了可能修改图数据或 Schema 的查询");
    }
    if (
      profile.environment === "prod" &&
      isMutationQuery(request.query) &&
      request.productionConfirmed !== true
    ) {
      throw new Error("生产环境写操作尚未确认，查询已被安全阻止");
    }
    const password = await this.connections.passwordFor(request.connectionId);
    const startedAt = performance.now();
    const normalizedQuery = normalizeManagementConsoleText(
      normalizeTraversalConsoleText(request.query),
      profile.clientMode,
    );

    try {
      const result = await this.gremlin.execute(
        profile,
        password,
        request.consoleId,
        request.executionId,
        normalizedQuery,
        request.bindings ?? {},
        request.timeoutMs,
        request.serverCancellation,
      );
      if (request.recordHistory !== false) {
        this.history.add(
          profile.id,
          profile.name,
          request.query,
          result.truncated ? "truncated" : "success",
          result.durationMs,
          result.totalCount,
          "",
          request.graphName ?? profile.graphBinding,
          profile.traversalSource,
        );
      }
      this.logger?.info("query", "query.completed", "Gremlin query completed", {
        connectionId: profile.id,
        executionId: request.executionId,
        durationMs: result.durationMs,
        totalCount: result.totalCount,
        truncated: result.truncated,
      });
      return result;
    } catch (error) {
      const durationMs = Math.round(performance.now() - startedAt);
      const message = error instanceof Error ? error.message : "查询执行失败";
      if (request.recordHistory !== false) {
        this.history.add(
          profile.id,
          profile.name,
          request.query,
          message === "查询已停止" ? "cancelled" : "error",
          durationMs,
          0,
          message,
          request.graphName ?? profile.graphBinding,
          profile.traversalSource,
        );
      }
      this.logger?.write({
        level: "error",
        source: "query",
        event: "query.failed",
        message: "Gremlin query failed",
        error,
        context: {
          connectionId: profile.id,
          executionId: request.executionId,
          durationMs,
          cancelled: message === "查询已停止",
        },
        sensitiveTexts: [
          request.query,
          normalizedQuery,
          ...collectStringValues(request.bindings),
        ],
      });
      throw error;
    }
  }

  async export(request: QueryExportRequest): Promise<QueryExportResult> {
    if (isMutationQuery(request.query)) {
      throw new Error("完整结果流式导出仅允许只读 Gremlin 查询");
    }
    const storedProfile = this.connections.profile(request.connectionId);
    const profile = request.traversalSource
      ? { ...storedProfile, traversalSource: request.traversalSource }
      : storedProfile;
    const password = await this.connections.passwordFor(request.connectionId);
    return this.files.streamQueryResult(
      request.suggestedName,
      request.format,
      (writeItems) => this.gremlin.exportAll(
        profile,
        password,
        request.executionId,
        request.query,
        request.bindings ?? {},
        writeItems,
      ),
    );
  }

  async cancel(executionId: string): Promise<boolean> {
    return this.gremlin.cancelExecution(executionId);
  }

  async closeConsole(connectionId: string, consoleId: string): Promise<void> {
    await this.gremlin.closeConsole(connectionId, consoleId);
  }
}
