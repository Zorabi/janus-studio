import type { RunSchemaJobInput, SchemaJob } from "@janusgraph/domain";
import { randomUUID } from "node:crypto";
import { ConnectionService } from "./connection-service";
import { QueryService } from "./query-service";
import { SchemaJobRepository } from "../storage/schema-job-repository";

export class SchemaJobService {
  constructor(
    private readonly repository: SchemaJobRepository,
    private readonly connections: ConnectionService,
    private readonly queries: QueryService,
  ) {}

  list(connectionId?: string): SchemaJob[] {
    return this.repository.list(connectionId);
  }

  async run(input: RunSchemaJobInput): Promise<SchemaJob> {
    const connection = this.connections.profile(input.connectionId);
    const job = this.repository.create(input, connection.name);
    const started = performance.now();
    try {
      await this.queries.execute({
        connectionId: input.connectionId,
        consoleId: `schema-job-${job.id}`,
        executionId: randomUUID(),
        query: input.query,
        bindings: {},
        recordHistory: false,
      });
      return this.repository.finish(job.id, "succeeded", "Operation completed", Math.round(performance.now() - started));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Schema operation failed";
      this.repository.finish(job.id, "failed", message, Math.round(performance.now() - started));
      throw error;
    } finally {
      await this.queries.closeConsole(input.connectionId, `schema-job-${job.id}`);
    }
  }

  async retry(id: string): Promise<SchemaJob> {
    const previous = this.repository.get(id);
    if (!previous) throw new Error("Schema job not found");
    if (previous.status === "running") throw new Error("Schema job is still running");
    return this.run({
      connectionId: previous.connectionId,
      indexName: previous.indexName,
      action: previous.action,
      query: previous.query,
    });
  }
}
