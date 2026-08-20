import { randomUUID } from "node:crypto";
import type {
  BackgroundTask,
  ExportQualityIssuesInput,
  QualityIssueExportResult,
  QualityRule,
  QualityRuleResult,
  QualityRuleSet,
  QualityRun,
  QualityRunDetail,
  QualityRunListInput,
  QualitySample,
  SaveQualityRuleSetInput,
  StartQualityRunInput,
} from "@janusgraph/domain";
import { BackgroundTaskRepository } from "../storage/background-task-repository";
import { QualityRepository } from "../storage/quality-repository";
import { ConnectionService } from "./connection-service";
import { FileService } from "./file-service";
import { QueryService } from "./query-service";
import { buildDuplicateBatchScript, buildQualityIssueBatchScript, buildQualityScript, type QualityScriptContext } from "./data-quality-scripts";

const RUN_TIMEOUT_MAX = 86_400_000;
const DUPLICATE_BATCH_SIZE = 2_000;
const ISSUE_EXPORT_BATCH_SIZE = 1_000;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "质量检查失败";
}

function unwrap(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(unwrap);
  if (!value || typeof value !== "object") return value;
  const source = value as Record<string, unknown>;
  if (source["@type"] === "g:Map" && Array.isArray(source["@value"])) {
    const entries = source["@value"] as unknown[];
    const output: Record<string, unknown> = {};
    for (let index = 0; index < entries.length; index += 2) output[String(unwrap(entries[index]))] = unwrap(entries[index + 1]);
    return output;
  }
  if ("@type" in source && "@value" in source) return unwrap(source["@value"]);
  return Object.fromEntries(Object.entries(source).map(([key, item]) => [key, unwrap(item)]));
}

function record(value: unknown): Record<string, unknown> {
  const normalized = unwrap(value);
  return normalized && typeof normalized === "object" && !Array.isArray(normalized) ? normalized as Record<string, unknown> : {};
}

function responseRecord(items: unknown[]): Record<string, unknown> {
  const first = items[0];
  return record(Array.isArray(first) ? first[0] : first);
}

function number(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function scalar(value: unknown): string | number | boolean | null {
  if (value == null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value as string | number | boolean | null;
  return JSON.stringify(value);
}

function inlineQualityQuery(query: string, bindings: Record<string, unknown>): string {
  return Object.entries(bindings).sort(([left],[right])=>right.length-left.length).reduce((text,[name,value]) =>
    text.replace(new RegExp(`\\b${name}\\b`, "g"), JSON.stringify(value)), query);
}

function samples(value: unknown, limit: number): QualitySample[] {
  const normalized = unwrap(value);
  if (!Array.isArray(normalized)) return [];
  return normalized.slice(0, limit).map((item, index) => {
    const row = record(item);
    const values: QualitySample["values"] = {};
    for (const [key, raw] of Object.entries(row)) {
      if (key === "values") {
        for (const [nestedKey, nestedValue] of Object.entries(record(raw))) values[nestedKey] = scalar(nestedValue);
      } else if (key !== "id" && key !== "label") values[key] = scalar(raw);
    }
    const rawId = row.id ?? index + 1;
    const id = typeof rawId === "string" || typeof rawId === "number" ? rawId : String(rawId);
    return { id, label: String(row.label ?? "result"), values };
  });
}

export class DataQualityService {
  private readonly running = new Map<string, { executionId: string; work: Promise<void> }>();

  constructor(
    private readonly repository: QualityRepository,
    private readonly tasks: BackgroundTaskRepository,
    private readonly connections: ConnectionService,
    private readonly queries: QueryService,
    private readonly files: FileService,
  ) {
    for (const id of this.repository.interruptRunning()) {
      const interrupted = this.repository.getRun(id);
      if (interrupted) {
        try { this.publishTask(interrupted); } catch { /* Connection may have been removed while the app was closed. */ }
      }
    }
  }

  listRuleSets(connectionId?: string): QualityRuleSet[] { return this.repository.listRuleSets(connectionId); }
  saveRuleSet(input: SaveQualityRuleSetInput): QualityRuleSet { this.connections.profile(input.connectionId); return this.repository.saveRuleSet(input); }
  removeRuleSet(id: string): void { this.repository.removeRuleSet(id); }
  listRuns(input?: QualityRunListInput): QualityRun[] { return this.repository.listRuns(input); }
  getRun(id: string): QualityRunDetail { const value = this.repository.getRunDetail(id); if (!value) throw new Error("质量检查记录不存在"); return value; }
  removeRun(id: string): void { this.repository.removeRun(id); }

  start(input: StartQualityRunInput): QualityRun {
    return this.startInternal(input);
  }

  private startInternal(input: StartQualityRunInput, resume?: QualityRunDetail): QualityRun {
    const ruleSet = this.repository.getRuleSet(input.ruleSetId);
    if (!ruleSet) throw new Error("质量规则集不存在");
    const profile = this.connections.profile(ruleSet.connectionId);
    const active = this.repository.listRuns({ connectionId: ruleSet.connectionId, statuses: ["running", "cancel_requested"], limit: 10 });
    if (active.some((run) => run.mode === "full" || input.mode === "full")) throw new Error("该连接已有检查任务；同一连接最多运行 1 个全量检查");
    const global = this.repository.listRuns({ statuses: ["running", "cancel_requested"], limit: 10 });
    if (global.length >= 2) throw new Error("全局最多同时运行 2 个质量检查");
    const enabled = ruleSet.rules.filter((rule) => rule.enabled);
    if (!enabled.length) throw new Error("规则集中没有已启用规则");
    if (input.mode === "full" && profile.environment === "prod" && (!input.productionConfirmed || input.confirmedGraphName !== ruleSet.graphName)) {
      throw new Error("生产环境全量检查必须输入完整图名称确认");
    }
    const now = new Date().toISOString();
    const run: QualityRun = {
      id: randomUUID(), ruleSetId: ruleSet.id, ruleSetName: ruleSet.name,
      connectionId: ruleSet.connectionId, connectionName: profile.name,
      graphName: ruleSet.graphName, graphBinding: ruleSet.graphBinding, graphAccess: ruleSet.graphAccess,
      mode: input.mode, sampleLimit: input.sampleLimit ?? 50, scanLimit: input.mode === "bounded" ? input.scanLimit ?? 10_000 : 0,
      status: "running", stage: "preflight", currentRule: 0, totalRules: enabled.length,
      issueCount: 0, checkedCount: 0, message: input.mode === "bounded" ? `有界检查，最多扫描 ${input.scanLimit ?? 10_000} 个元素` : "正在进行全量检查",
      ruleSetSnapshot: structuredClone(ruleSet), createdAt: now, updatedAt: now, completedAt: "",
    };
    this.repository.createRun(run);
    let resumeIndex = 0;
    if (resume) {
      resumeIndex = resume.results.findIndex((result) => !["passed", "issues", "skipped"].includes(result.status));
      if (resumeIndex < 0) resumeIndex = resume.results.length;
      for (const previous of resume.results.slice(0, resumeIndex)) this.repository.saveResult({ ...previous, id: randomUUID(), runId: run.id });
      this.repository.updateRun(run.id, {
        currentRule: resumeIndex,
        issueCount: resume.results.slice(0, resumeIndex).reduce((total, result) => total + result.issueCount, 0),
        checkedCount: resume.results.slice(0, resumeIndex).reduce((total, result) => total + result.checkedCount, 0),
        message: `从第 ${resumeIndex + 1} 条未完成规则继续`,
      });
    }
    this.publishTask(this.repository.getRun(run.id)!);
    const state = { executionId: "", work: Promise.resolve() };
    this.running.set(run.id, state);
    const work = this.execute(run.id, input.timeoutMs ?? profile.queryTimeoutMs, resumeIndex).finally(() => this.running.delete(run.id));
    state.work = work;
    void work;
    return this.repository.getRun(run.id)!;
  }

  async cancel(id: string): Promise<boolean> {
    const run = this.repository.getRun(id);
    if (!run || run.status !== "running") return false;
    const profile = this.connections.profile(run.connectionId);
    this.repository.updateRun(id, { status: "cancel_requested", stage: "cancelling", message: profile.protocol === "http" || profile.protocol === "https"
      ? "客户端已中止 HTTP 请求；服务端是否立即停止取决于 JanusGraph Server，应用不会执行下一条规则"
      : "正在关闭本次专用执行请求；停止后不再执行下一条规则" });
    const state = this.running.get(id);
    if (state?.executionId) await this.queries.cancel(state.executionId).catch(() => false);
    const task = this.tasks.get(id);
    if (task?.status === "running") this.tasks.requestCancellation(id, "正在停止当前质量检查请求");
    return true;
  }

  retry(id: string): QualityRun {
    const previous = this.getRun(id);
    if (previous.status !== "failed" && previous.status !== "interrupted") throw new Error("仅失败或中断的检查可以重试");
    return this.startInternal({ ruleSetId: previous.ruleSetId, mode: previous.mode, scanLimit: previous.scanLimit || undefined, sampleLimit: previous.sampleLimit }, previous);
  }

  async exportRun(id: string): Promise<string | null> {
    const detail = this.getRun(id);
    const safe = {
      format: "janus-studio.quality-report/v1",
      summary: { status:detail.status, issueCount:detail.issueCount, checkedCount:detail.checkedCount, completedRules:detail.currentRule, totalRules:detail.totalRules },
      run: { ...detail, results: detail.results.map(({ samples: rows, ...result }) => ({ ...result, samples: rows })) },
    };
    return this.files.saveDataFile({ suggestedName: `quality-report-${detail.graphName}-${detail.createdAt.slice(0, 10).replaceAll("-", "")}.json`, format: "json", content: JSON.stringify(safe, null, 2) });
  }

  async exportIssues(input: ExportQualityIssuesInput): Promise<QualityIssueExportResult> {
    const detail = this.getRun(input.runId);
    if (detail.status !== "succeeded") throw new Error("仅已完成的检查可以导出完整问题数据");
    if (detail.issueCount === 0) throw new Error("本次检查没有问题数据；请导出审计报告查看检查范围与指标");
    const taskId = randomUUID();
    const extension = input.format === "jsonl" ? "jsonl" : input.format;
    const date = detail.createdAt.slice(0, 10).replaceAll("-", "");
    let taskStarted = false;
    let exported = 0;
    const publish = (status: BackgroundTask["status"], stage: string, message: string, current: number) => this.tasks.publish({
      id: taskId, kind: "quality", action: "export", title: `完整问题数据 · ${detail.graphName}`,
      connectionId: detail.connectionId, graphName: detail.graphName, status, stage, message,
      progressCurrent: current, progressTotal: detail.issueCount, progressUnit: "issue", cancellable: false, retriable: false,
    }, detail.connectionName);
    try {
      const output = await this.files.saveGeneratedRows(
        `quality-issues-${detail.graphName}-${date}.${extension}`,
        input.format,
        [
          { key:"ruleName", label:"规则" }, { key:"severity", label:"级别" }, { key:"elementType", label:"元素类型" },
          { key:"id", label:"元素 ID" }, { key:"label", label:"标签" }, { key:"issueDetails", label:"问题说明" }, { key:"propertiesText", label:"属性快照" },
        ],
        async (writeRows) => {
          taskStarted = true;
          publish("running", "reading", "正在按原检查范围重新读取全部问题数据", 0);
          for await (const batch of this.issueBatches(detail)) {
            await writeRows(batch);
            exported += batch.length;
            publish("running", "writing", `已导出 ${exported.toLocaleString()} 条问题数据`, exported);
          }
          return exported;
        },
      );
      if (output.path) publish("succeeded", "completed", `已导出 ${output.exportedCount.toLocaleString()} 条完整问题数据`, output.exportedCount);
      return output;
    } catch (error) {
      if (taskStarted) publish("failed", "failed", errorMessage(error), exported);
      throw error;
    }
  }

  private async *issueBatches(detail: QualityRunDetail): AsyncGenerator<Record<string, unknown>[]> {
    const rules = new Map(detail.ruleSetSnapshot.rules.map((rule) => [rule.id, rule]));
    const profile = this.connections.profile(detail.connectionId);
    const timeoutMs = Math.min(Math.max(profile.queryTimeoutMs, 60_000), RUN_TIMEOUT_MAX);
    for (const result of detail.results) {
      if (result.status !== "issues" || result.issueCount === 0 || result.ruleKind === "distribution") continue;
      const rule = rules.get(result.ruleId);
      if (!rule) continue;
      if (rule.kind === "duplicate-vertex") {
        yield* this.duplicateIssueBatches(detail, rule, timeoutMs);
        continue;
      }
      let offset = 0;
      while (true) {
        const script = buildQualityIssueBatchScript(rule, this.context(detail), offset, ISSUE_EXPORT_BATCH_SIZE);
        const response = await this.queries.execute({ connectionId:detail.connectionId, consoleId:`quality-export:${detail.id}`, executionId:randomUUID(), query:script.query, bindings:script.bindings,
          recordHistory:false, timeoutMs, serverCancellation:true, traversalSource:detail.graphAccess === "binding" ? this.context(detail).traversalSource : undefined });
        const batch = samples(responseRecord(response.items).samples, ISSUE_EXPORT_BATCH_SIZE);
        if (batch.length) yield batch.map((sample) => this.issueExportRow(rule, sample));
        offset += batch.length;
        if (batch.length < ISSUE_EXPORT_BATCH_SIZE) break;
      }
    }
  }

  private async *duplicateIssueBatches(detail: QualityRunDetail, rule: QualityRule, timeoutMs: number): AsyncGenerator<Record<string, unknown>[]> {
    const counts = new Map<string, number>();
    const max = detail.mode === "bounded" ? detail.scanLimit : Number.MAX_SAFE_INTEGER;
    const read = async (offset: number) => {
      const batchSize = Math.min(DUPLICATE_BATCH_SIZE, max - offset);
      const script = buildDuplicateBatchScript(rule, this.context(detail), offset, batchSize);
      const response = await this.queries.execute({ connectionId:detail.connectionId, consoleId:`quality-export:${detail.id}`, executionId:randomUUID(), query:script.query, bindings:script.bindings,
        recordHistory:false, timeoutMs, serverCancellation:true, traversalSource:detail.graphAccess === "binding" ? this.context(detail).traversalSource : undefined });
      return { batchSize, rows: samples(responseRecord(response.items).samples, batchSize) };
    };
    let offset = 0;
    while (offset < max) {
      const { batchSize, rows } = await read(offset);
      for (const sample of rows) {
        if (rule.ignoreMissing && Object.values(sample.values).some((value) => value == null || value === "")) continue;
        const signature = JSON.stringify((rule.propertyKeys ?? []).map((key) => sample.values[key] ?? null));
        counts.set(signature, (counts.get(signature) ?? 0) + 1);
      }
      offset += rows.length;
      if (rows.length < batchSize) break;
    }
    offset = 0;
    while (offset < max) {
      const { batchSize, rows } = await read(offset);
      const issues = rows.filter((sample) => {
        if (rule.ignoreMissing && Object.values(sample.values).some((value) => value == null || value === "")) return false;
        const signature = JSON.stringify((rule.propertyKeys ?? []).map((key) => sample.values[key] ?? null));
        return (counts.get(signature) ?? 0) > 1;
      }).map((sample) => this.issueExportRow(rule, sample));
      if (issues.length) yield issues;
      offset += rows.length;
      if (rows.length < batchSize) break;
    }
  }

  private issueExportRow(rule: QualityRule, sample: QualitySample): Record<string, unknown> {
    const detailKeys = new Set(["missing", "value", "outLabel", "inLabel"]);
    const details = Object.entries(sample.values).filter(([key]) => detailKeys.has(key)).map(([key,value]) => `${key}: ${value ?? "null"}`).join("; ");
    const properties = Object.fromEntries(Object.entries(sample.values).filter(([key]) => !detailKeys.has(key)));
    return {
      ruleName: rule.name, severity: rule.severity, ruleType: rule.kind,
      elementType: rule.kind === "edge-endpoint" ? "edge" : "vertex", id: sample.id, label: sample.label,
      issueDetails: details || rule.name, properties, propertiesText: Object.entries(properties).map(([key,value]) => `${key}=${value ?? "null"}`).join("; "),
    };
  }

  private async execute(id: string, rawTimeout: number, resumeIndex: number): Promise<void> {
    const run = this.repository.getRun(id)!;
    const profile = this.connections.profile(run.connectionId);
    const rules = run.ruleSetSnapshot.rules.filter((rule) => rule.enabled);
    const timeoutMs = Math.min(Math.max(rawTimeout, 1_000), RUN_TIMEOUT_MAX);
    try {
      this.repository.updateRun(id, { stage: "validating-schema", message: "已固定规则与目标图快照，正在验证执行条件" });
      for (let index = resumeIndex; index < rules.length; index += 1) {
        if (this.repository.getRun(id)?.status !== "running") throw new Error("查询已停止");
        const rule = rules[index]!;
        this.repository.updateRun(id, { stage: "running-rule", currentRule: index, message: `正在执行 ${rule.name}` });
        this.publishTask(this.repository.getRun(id)!);
        let result: QualityRuleResult;
        try {
          result = await this.executeRule(id, rule, index, timeoutMs, profile.protocol, profile.clientMode);
        } catch (error) {
          const interrupted = this.repository.getRun(id)?.status === "cancel_requested" || errorMessage(error) === "查询已停止";
          this.repository.saveResult(this.makeResult(id, rule, interrupted ? "interrupted" : "failed", 0, 0, [], errorMessage(error), "", new Date().toISOString()));
          throw error;
        }
        this.repository.updateRun(id, { stage: "collecting-samples", message: `正在整理 ${rule.name} 的有界样本与指标` });
        this.publishTask(this.repository.getRun(id)!);
        this.repository.saveResult(result);
        const current = this.repository.getRun(id)!;
        this.repository.updateRun(id, { currentRule: index + 1, issueCount: current.issueCount + result.issueCount, checkedCount: current.checkedCount + result.checkedCount, message: `${rule.name} 已完成` });
      }
      this.repository.updateRun(id, { stage: "finalizing", currentRule: rules.length, message: "正在汇总检查结果并固定审计快照" });
      this.publishTask(this.repository.getRun(id)!);
      const finished = this.repository.updateRun(id, { status: "succeeded", stage: "completed", currentRule: rules.length, message: "质量检查已完成", completedAt: new Date().toISOString() });
      this.publishTask(finished);
    } catch (error) {
      const current = this.repository.getRun(id)!;
      const interrupted = current.status === "cancel_requested" || errorMessage(error) === "查询已停止";
      const finished = this.repository.updateRun(id, { status: interrupted ? "interrupted" : "failed", stage: interrupted ? "interrupted" : current.stage, message: interrupted ? "质量检查已中断；已完成结果保留，可显式重试" : errorMessage(error), completedAt: new Date().toISOString() });
      this.publishTask(finished);
    }
  }

  private context(run: QualityRun): QualityScriptContext {
    const profile = this.connections.profile(run.connectionId);
    return { graphAccess: run.graphAccess, graphName: run.graphName, graphBinding: run.graphBinding, traversalSource: profile.traversalSource,
      mode: run.mode, scanLimit: run.scanLimit, sampleLimit: run.sampleLimit };
  }

  private async executeRule(runId: string, rule: QualityRule, index: number, timeoutMs: number, protocol: string, clientMode: string): Promise<QualityRuleResult> {
    const run = this.repository.getRun(runId)!;
    const startedAt = new Date().toISOString();
    if (rule.kind === "duplicate-vertex") {
      if (run.mode === "full" && (!["ws", "wss"].includes(protocol) || clientMode !== "sessioned")) {
        return this.makeResult(runId, rule, "skipped", 0, 0, [], "全量重复检查仅支持 WS/WSS Sessioned 客户端；HTTP/HTTPS 禁用以避免无界服务端聚合", "", startedAt);
      }
      return this.executeDuplicate(run, rule, index, timeoutMs, startedAt);
    }
    const script = buildQualityScript(rule, this.context(run));
    const executionId = `${runId}:${index}`;
    this.setExecution(runId, executionId);
    const response = await this.queries.execute({ connectionId: run.connectionId, consoleId: `quality:${runId}`, executionId, query: script.query, bindings: script.bindings,
      recordHistory: false, timeoutMs, serverCancellation: true, traversalSource: run.graphAccess === "binding" ? this.context(run).traversalSource : undefined });
    const row = responseRecord(response.items);
    const checked = number(row.checkedCount);
    const issues = number(row.issueCount);
    return this.makeResult(runId, rule, issues ? "issues" : "passed", issues, checked, samples(row.samples, rule.kind === "distribution" ? 10_000 : run.sampleLimit), run.mode === "bounded" ? `有界结果：最多扫描 ${run.scanLimit} 个元素，不代表全图` : "全量规则执行完成", inlineQualityQuery(script.query, script.bindings), startedAt);
  }

  private async executeDuplicate(run: QualityRun, rule: QualityRule, index: number, timeoutMs: number, startedAt: string): Promise<QualityRuleResult> {
    const groups = new Map<string, { count: number; samples: QualitySample[] }>();
    let checked = 0;
    let offset = 0;
    const max = run.mode === "bounded" ? run.scanLimit : Number.MAX_SAFE_INTEGER;
    while (offset < max) {
      if (this.repository.getRun(run.id)?.status !== "running") throw new Error("查询已停止");
      const batchSize = Math.min(DUPLICATE_BATCH_SIZE, max - offset);
      const script = buildDuplicateBatchScript(rule, this.context(run), offset, batchSize);
      const executionId = `${run.id}:${index}:${offset}`;
      this.setExecution(run.id, executionId);
      const response = await this.queries.execute({ connectionId: run.connectionId, consoleId: `quality:${run.id}`, executionId, query: script.query, bindings: script.bindings,
        recordHistory: false, timeoutMs, serverCancellation: true, traversalSource: run.graphAccess === "binding" ? this.context(run).traversalSource : undefined });
      const row = responseRecord(response.items);
      const rows = Array.isArray(row.samples) ? row.samples : [];
      for (const raw of rows) {
        const item = record(raw); const values = record(item.values);
        if (rule.ignoreMissing && Object.values(values).some((value) => value == null || value === "")) continue;
        const key = JSON.stringify((rule.propertyKeys ?? []).map((name) => values[name] ?? null));
        const group = groups.get(key) ?? { count: 0, samples: [] };
        group.count += 1;
        if (group.samples.length < run.sampleLimit) group.samples.push({ id: String(item.id ?? ""), label: String(item.label ?? rule.vertexLabel ?? "vertex"), values: Object.fromEntries(Object.entries(values).map(([name, value]) => [name, scalar(value)])) });
        groups.set(key, group);
      }
      checked += rows.length;
      offset += rows.length;
      if (rows.length < batchSize) break;
      this.repository.updateRun(run.id, { message: `重复候选检查已扫描 ${checked} 个顶点` });
      this.publishTask(this.repository.getRun(run.id)!);
    }
    const duplicateGroups = [...groups.values()].filter((group) => group.count > 1);
    const issueCount = duplicateGroups.reduce((total, group) => total + group.count, 0);
    const output = duplicateGroups.flatMap((group) => group.samples).slice(0, run.sampleLimit);
    return this.makeResult(run.id, rule, issueCount ? "issues" : "passed", issueCount, checked, output,
      run.mode === "bounded" ? `有界重复候选：最多扫描 ${run.scanLimit} 个顶点` : `客户端按 ${DUPLICATE_BATCH_SIZE} 个顶点分批聚合，未向服务端发送无界 groupCount`, "客户端分批属性签名聚合", startedAt);
  }

  private makeResult(runId: string, rule: QualityRule, status: QualityRuleResult["status"], issueCount: number, checkedCount: number,
    rows: QualitySample[], message: string, query: string, startedAt: string): QualityRuleResult {
    const run = this.repository.getRun(runId)!;
    return { id: randomUUID(), runId, ruleId: rule.id, ruleName: rule.name, ruleKind: rule.kind, severity: rule.severity, status,
      issueCount, checkedCount, coverageLimit: run.mode === "bounded" ? run.scanLimit : 0, message, query, samples: rule.kind === "distribution" ? rows : rows.slice(0, run.sampleLimit), startedAt, completedAt: new Date().toISOString() };
  }

  private setExecution(runId: string, executionId: string): void {
    const state = this.running.get(runId); if (state) state.executionId = executionId;
  }

  private publishTask(run: QualityRun): BackgroundTask {
    return this.tasks.publish({ id: run.id, kind: "quality", action: "quality-check", title: `${run.ruleSetName} · ${run.graphName}`,
      connectionId: run.connectionId, graphName: run.graphName, status: run.status, stage: run.stage, message: run.message,
      progressCurrent: run.currentRule, progressTotal: run.totalRules, progressUnit: "rule", cancellable: run.status === "running", retriable: run.status === "failed" || run.status === "interrupted" }, run.connectionName);
  }
}
