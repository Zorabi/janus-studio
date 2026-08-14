import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type {
  QualityRuleResult,
  QualityRuleSet,
  QualityRun,
  QualityRunDetail,
  QualityRunListInput,
  SaveQualityRuleSetInput,
} from "@janusgraph/domain";

type Row = Record<string, unknown>;
const text = (row: Row, key: string) => String(row[key] ?? "");
const number = (row: Row, key: string) => Number(row[key] ?? 0);

function ruleSet(row: Row): QualityRuleSet {
  return {
    id: text(row, "id"), name: text(row, "name"), description: text(row, "description"),
    connectionId: text(row, "connection_id"), graphName: text(row, "graph_name"),
    graphBinding: text(row, "graph_binding"), graphAccess: text(row, "graph_access") as QualityRuleSet["graphAccess"],
    rules: JSON.parse(text(row, "rules_json")), createdAt: text(row, "created_at"), updatedAt: text(row, "updated_at"),
  };
}

function run(row: Row): QualityRun {
  return {
    id: text(row, "id"), ruleSetId: text(row, "rule_set_id"), ruleSetName: text(row, "rule_set_name"),
    connectionId: text(row, "connection_id"), connectionName: text(row, "connection_name"),
    graphName: text(row, "graph_name"), graphBinding: text(row, "graph_binding"),
    graphAccess: text(row, "graph_access") as QualityRun["graphAccess"], mode: text(row, "mode") as QualityRun["mode"],
    sampleLimit: number(row, "sample_limit"), scanLimit: number(row, "scan_limit"),
    status: text(row, "status") as QualityRun["status"], stage: text(row, "stage"),
    currentRule: number(row, "current_rule"), totalRules: number(row, "total_rules"),
    issueCount: number(row, "issue_count"), checkedCount: number(row, "checked_count"), message: text(row, "message"),
    ruleSetSnapshot: JSON.parse(text(row, "rule_set_snapshot_json")),
    createdAt: text(row, "created_at"), updatedAt: text(row, "updated_at"), completedAt: text(row, "completed_at"),
  };
}

function result(row: Row): QualityRuleResult {
  return {
    id: text(row, "id"), runId: text(row, "run_id"), ruleId: text(row, "rule_id"), ruleName: text(row, "rule_name"),
    ruleKind: text(row, "rule_kind") as QualityRuleResult["ruleKind"], severity: text(row, "severity") as QualityRuleResult["severity"],
    status: text(row, "status") as QualityRuleResult["status"], issueCount: number(row, "issue_count"), checkedCount: number(row, "checked_count"),
    coverageLimit: number(row, "coverage_limit"), message: text(row, "message"), query: text(row, "query_text"),
    samples: JSON.parse(text(row, "samples_json")), startedAt: text(row, "started_at"), completedAt: text(row, "completed_at"),
  };
}

export class QualityRepository {
  constructor(private readonly database: DatabaseSync) {}

  listRuleSets(connectionId?: string): QualityRuleSet[] {
    const rows = connectionId
      ? this.database.prepare("SELECT * FROM quality_rule_sets WHERE connection_id = ? ORDER BY updated_at DESC").all(connectionId)
      : this.database.prepare("SELECT * FROM quality_rule_sets ORDER BY updated_at DESC").all();
    return (rows as Row[]).map(ruleSet);
  }

  getRuleSet(id: string): QualityRuleSet | undefined {
    const row = this.database.prepare("SELECT * FROM quality_rule_sets WHERE id = ?").get(id) as Row | undefined;
    return row ? ruleSet(row) : undefined;
  }

  saveRuleSet(input: SaveQualityRuleSetInput): QualityRuleSet {
    const previous = input.id ? this.getRuleSet(input.id) : undefined;
    const now = new Date().toISOString();
    const value: QualityRuleSet = { ...input, id: input.id ?? randomUUID(), createdAt: previous?.createdAt ?? now, updatedAt: now };
    this.database.prepare(`INSERT OR REPLACE INTO quality_rule_sets
      (id,name,description,connection_id,graph_name,graph_binding,graph_access,rules_json,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)`).run(value.id, value.name, value.description, value.connectionId, value.graphName,
      value.graphBinding, value.graphAccess, JSON.stringify(value.rules), value.createdAt, value.updatedAt);
    return this.getRuleSet(value.id)!;
  }

  removeRuleSet(id: string): void {
    this.database.prepare("DELETE FROM quality_rule_sets WHERE id = ?").run(id);
  }

  createRun(value: QualityRun): QualityRun {
    this.database.prepare(`INSERT INTO quality_runs
      (id,rule_set_id,rule_set_name,connection_id,connection_name,graph_name,graph_binding,graph_access,mode,sample_limit,scan_limit,status,stage,current_rule,total_rules,issue_count,checked_count,message,rule_set_snapshot_json,created_at,updated_at,completed_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(value.id,value.ruleSetId,value.ruleSetName,value.connectionId,value.connectionName,
      value.graphName,value.graphBinding,value.graphAccess,value.mode,value.sampleLimit,value.scanLimit,value.status,value.stage,value.currentRule,
      value.totalRules,value.issueCount,value.checkedCount,value.message,JSON.stringify(value.ruleSetSnapshot),value.createdAt,value.updatedAt,value.completedAt);
    this.database.exec(`DELETE FROM quality_runs WHERE id IN (
      SELECT id FROM quality_runs WHERE status NOT IN ('running','cancel_requested') ORDER BY created_at DESC LIMIT -1 OFFSET 200
    )`);
    return this.getRun(value.id)!;
  }

  updateRun(id: string, patch: Partial<Pick<QualityRun, "status"|"stage"|"currentRule"|"issueCount"|"checkedCount"|"message"|"completedAt">>): QualityRun {
    const current = this.getRun(id);
    if (!current) throw new Error("质量检查任务不存在");
    const next = { ...current, ...patch, updatedAt: new Date().toISOString() };
    this.database.prepare(`UPDATE quality_runs SET status=?,stage=?,current_rule=?,issue_count=?,checked_count=?,message=?,updated_at=?,completed_at=? WHERE id=?`)
      .run(next.status,next.stage,next.currentRule,next.issueCount,next.checkedCount,next.message,next.updatedAt,next.completedAt,id);
    return this.getRun(id)!;
  }

  getRun(id: string): QualityRun | undefined {
    const row = this.database.prepare("SELECT * FROM quality_runs WHERE id = ?").get(id) as Row | undefined;
    return row ? run(row) : undefined;
  }

  getRunDetail(id: string): QualityRunDetail | undefined {
    const value = this.getRun(id);
    if (!value) return undefined;
    return { ...value, results: (this.database.prepare("SELECT * FROM quality_rule_results WHERE run_id = ? ORDER BY started_at, id").all(id) as Row[]).map(result) };
  }

  listRuns(input: QualityRunListInput = {}): QualityRun[] {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (input.connectionId) { clauses.push("connection_id = ?"); params.push(input.connectionId); }
    if (input.ruleSetId) { clauses.push("rule_set_id = ?"); params.push(input.ruleSetId); }
    if (input.statuses?.length) { clauses.push(`status IN (${input.statuses.map(() => "?").join(",")})`); params.push(...input.statuses); }
    params.push(input.limit ?? 200);
    return (this.database.prepare(`SELECT * FROM quality_runs ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""} ORDER BY created_at DESC LIMIT ?`).all(...params as Array<string | number>) as Row[]).map(run);
  }

  saveResult(value: QualityRuleResult): void {
    this.database.prepare(`INSERT OR REPLACE INTO quality_rule_results
      (id,run_id,rule_id,rule_name,rule_kind,severity,status,issue_count,checked_count,coverage_limit,message,query_text,samples_json,started_at,completed_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(value.id,value.runId,value.ruleId,value.ruleName,value.ruleKind,value.severity,value.status,
      value.issueCount,value.checkedCount,value.coverageLimit,value.message,value.query,JSON.stringify(value.samples),value.startedAt,value.completedAt);
  }

  removeRun(id: string): void {
    const value = this.getRun(id);
    if (value?.status === "running" || value?.status === "cancel_requested") throw new Error("运行中的质量检查不能删除");
    this.database.prepare("DELETE FROM quality_runs WHERE id = ?").run(id);
  }

  interruptRunning(): string[] {
    const ids = (this.database.prepare("SELECT id FROM quality_runs WHERE status IN ('running','cancel_requested')").all() as Array<{id:string}>).map((row) => row.id);
    const now = new Date().toISOString();
    this.database.prepare("UPDATE quality_runs SET status='interrupted',stage='interrupted',message='应用退出导致任务中断，可显式重试',updated_at=?,completed_at=? WHERE status IN ('running','cancel_requested')").run(now, now);
    return ids;
  }
}
