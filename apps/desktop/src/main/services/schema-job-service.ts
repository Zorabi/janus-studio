import type { RunSchemaJobInput, SchemaJob } from "@janusgraph/domain";
import { randomUUID } from "node:crypto";
import { ConnectionService } from "./connection-service";
import { QueryService } from "./query-service";
import { SchemaJobRepository } from "../storage/schema-job-repository";

const SCHEMA_BATCH_PREFIX = "/* janus-studio.schema-batches/v1 */\n";

function encodeSchemaQueries(query: string, queries?: string[]): string {
  return queries && queries.length > 1
    ? `${SCHEMA_BATCH_PREFIX}${JSON.stringify(queries)}`
    : query;
}

function decodeSchemaQueries(query: string): string[] {
  if (!query.startsWith(SCHEMA_BATCH_PREFIX)) return [query];
  const parsed = JSON.parse(query.slice(SCHEMA_BATCH_PREFIX.length)) as unknown;
  if (!Array.isArray(parsed) || parsed.length === 0 || parsed.some((item) => typeof item !== "string" || !item.trim())) {
    throw new Error("Schema batch job payload is invalid");
  }
  return parsed;
}

export class SchemaJobService {
  private readonly cancellationRequests = new Set<string>();
  private readonly activeExecutions = new Map<string, string>();

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
    const job = this.repository.create({
      ...input,
      query: encodeSchemaQueries(input.query, input.queries),
      queries: undefined,
    }, connection.name);
    return this.execute(job, input.productionConfirmed);
  }

  async retry(id: string): Promise<SchemaJob> {
    const previous = this.repository.get(id);
    if (!previous) throw new Error("Schema job not found");
    if (previous.status === "running") throw new Error("Schema job is still running");
    this.connections.profile(previous.connectionId);
    return this.execute(this.repository.restart(id));
  }

  async cancel(connectionId: string): Promise<boolean> {
    const running = this.repository.list(connectionId).filter((job) => job.status === "running");
    if (running.length === 0) return false;
    await Promise.all(running.map(async (job) => {
      this.cancellationRequests.add(job.id);
      const executionId = this.activeExecutions.get(job.id);
      if (executionId) await this.queries.cancel(executionId);
    }));
    return true;
  }

  dismiss(id: string): void {
    const job = this.repository.get(id);
    if (!job) return;
    if (job.status === "running") throw new Error("Schema job is still running");
    this.repository.remove(id);
  }

  private async execute(job: SchemaJob, productionConfirmed = false): Promise<SchemaJob> {
    const started = performance.now();
    let completedBatches = 0;
    let totalBatches = 1;
    try {
      const queries = decodeSchemaQueries(job.query);
      totalBatches = queries.length;
      for (const query of queries) {
        if (this.cancellationRequests.has(job.id)) throw new Error("Schema operation stopped");
        this.repository.progress(job.id, `Running batch ${completedBatches + 1}/${totalBatches}`);
        const executionId = randomUUID();
        this.activeExecutions.set(job.id, executionId);
        await this.queries.execute({
          connectionId: job.connectionId,
          consoleId: `schema-job-${job.id}`,
          executionId,
          query,
          bindings: {},
          recordHistory: false,
          productionConfirmed,
        });
        this.activeExecutions.delete(job.id);
        completedBatches += 1;
        this.repository.progress(job.id, `Completed ${completedBatches}/${totalBatches} batches`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Schema operation failed";
      const interrupted = this.cancellationRequests.has(job.id) || message === "查询已停止" || message === "Schema operation stopped";
      this.repository.finish(
        job.id,
        interrupted ? "interrupted" : "failed",
        interrupted
          ? `Stopped after ${completedBatches}/${totalBatches} batches`
          : totalBatches > 1
          ? `Batch ${completedBatches + 1}/${totalBatches} failed: ${message}`
          : message,
        Math.round(performance.now() - started),
      );
      throw interrupted
        ? new Error(`Schema import stopped after ${completedBatches}/${totalBatches} batches`)
        : error;
    } finally {
      this.activeExecutions.delete(job.id);
      this.cancellationRequests.delete(job.id);
      await this.queries.closeConsole(job.connectionId, `schema-job-${job.id}`);
    }
    const completed = this.repository.finish(
      job.id,
      "succeeded",
      totalBatches > 1
        ? `Completed ${completedBatches}/${totalBatches} batches`
        : "Operation completed",
      Math.round(performance.now() - started),
    );
    return completed;
  }
}
