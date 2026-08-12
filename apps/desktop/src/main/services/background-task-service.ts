import type { BackgroundTask, PublishBackgroundTaskInput } from "@janusgraph/domain";
import { ConnectionService } from "./connection-service";
import { BackgroundTaskRepository } from "../storage/background-task-repository";
import { SchemaJobRepository } from "../storage/schema-job-repository";

export class BackgroundTaskService {
  constructor(
    private readonly repository: BackgroundTaskRepository,
    private readonly schemaJobs: SchemaJobRepository,
    private readonly connections: ConnectionService,
  ) {}

  list(limit?: number): BackgroundTask[] {
    for (const job of this.schemaJobs.list(undefined, limit ?? 200)) {
      this.repository.syncSchema(job);
    }
    return this.repository.list(limit);
  }

  publish(input: PublishBackgroundTaskInput): BackgroundTask {
    const connection = this.connections.profile(input.connectionId);
    return this.repository.publish(input, connection.name);
  }

  acknowledge(id?: string): void {
    this.repository.acknowledge(id);
  }

  dismiss(id: string): void {
    this.repository.dismiss(id);
  }
}
