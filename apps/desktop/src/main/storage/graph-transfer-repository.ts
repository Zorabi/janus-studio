import type { StartGraphTransferInput } from "@janusgraph/domain";
import type { DatabaseSync } from "node:sqlite";
import type { BatchLoadingSnapshot } from "../../shared/server-graphson-transfer";

type GraphTransferRunRow = {
  task_id: string;
  input_json: string;
  recovery_json: string;
};

export class GraphTransferRepository {
  constructor(private readonly database: DatabaseSync) {}

  save(taskId: string, input: StartGraphTransferInput): void {
    this.database.prepare(`
      INSERT INTO graph_transfer_runs (task_id, input_json, recovery_json)
      VALUES (?, ?, '')
    `).run(taskId, JSON.stringify(input));
  }

  input(taskId: string): StartGraphTransferInput | undefined {
    const row = this.row(taskId);
    if (!row) return undefined;
    try {
      return JSON.parse(row.input_json) as StartGraphTransferInput;
    } catch {
      return undefined;
    }
  }

  recovery(taskId: string): BatchLoadingSnapshot | undefined {
    const value = this.row(taskId)?.recovery_json;
    if (!value) return undefined;
    try {
      return JSON.parse(value) as BatchLoadingSnapshot;
    } catch {
      return undefined;
    }
  }

  setRecovery(taskId: string, recovery: BatchLoadingSnapshot | null): void {
    this.database.prepare(
      "UPDATE graph_transfer_runs SET recovery_json = ? WHERE task_id = ?",
    ).run(recovery ? JSON.stringify(recovery) : "", taskId);
  }

  copy(sourceTaskId: string, targetTaskId: string): StartGraphTransferInput | undefined {
    const input = this.input(sourceTaskId);
    if (!input) return undefined;
    this.save(targetTaskId, input);
    const recovery = this.recovery(sourceTaskId);
    if (recovery) this.setRecovery(targetTaskId, recovery);
    return input;
  }

  private row(taskId: string): GraphTransferRunRow | undefined {
    return this.database.prepare(
      "SELECT task_id, input_json, recovery_json FROM graph_transfer_runs WHERE task_id = ?",
    ).get(taskId) as GraphTransferRunRow | undefined;
  }
}
