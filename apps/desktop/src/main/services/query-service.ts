import type { QueryExecutionResult, QueryExportRequest, QueryExportResult, QueryRequest } from "@janusgraph/domain";
import { ConnectionService } from "./connection-service";
import { GremlinService } from "./gremlin-service";
import { HistoryRepository } from "../storage/history-repository";
import { FileService } from "./file-service";

const MUTATING_QUERY = /\.(?:addV|addE|mergeV|mergeE|property|drop|iterate|write)\s*\(|openManagement\s*\(|\.tx\s*\(\)|\b(?:commit|rollback)\s*\(/i;

export class QueryService {
  constructor(
    private readonly connections: ConnectionService,
    private readonly gremlin: GremlinService,
    private readonly history: HistoryRepository,
    private readonly files: FileService,
  ) {}

  async execute(request: QueryRequest): Promise<QueryExecutionResult> {
    const profile = this.connections.profile(request.connectionId);
    const password = await this.connections.passwordFor(request.connectionId);
    const startedAt = performance.now();

    try {
      const result = await this.gremlin.execute(
        profile,
        password,
        request.consoleId,
        request.executionId,
        request.query,
        request.bindings ?? {},
      );
      if (request.recordHistory !== false) {
        this.history.add(
          profile.id,
          profile.name,
          request.query,
          "success",
          result.durationMs,
          result.totalCount,
        );
      }
      return result;
    } catch (error) {
      const durationMs = Math.round(performance.now() - startedAt);
      const message = error instanceof Error ? error.message : "查询执行失败";
      if (request.recordHistory !== false) {
        this.history.add(
          profile.id,
          profile.name,
          request.query,
          "error",
          durationMs,
          0,
          message,
        );
      }
      throw error;
    }
  }

  async export(request: QueryExportRequest): Promise<QueryExportResult> {
    if (MUTATING_QUERY.test(request.query)) {
      throw new Error("完整结果流式导出仅允许只读 Gremlin 查询");
    }
    const profile = this.connections.profile(request.connectionId);
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
