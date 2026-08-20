import type { ConnectionSummary, QualityIssueExportFormat, QualityRule, QualityRuleKind, QualityRuleResult, QualityRuleSet, QualityRun, QualityRunDetail, QualitySample, SaveQualityRuleSetInput } from "@janusgraph/domain";
import { AlertTriangle, BarChart3, Braces, Check, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, ClipboardCopy, Code2, Database, Eye, FileDown, FileJson2, Gauge, Layers3, ListChecks, LoaderCircle, Play, Plus, RefreshCw, RotateCcw, ScanSearch, ShieldCheck, Square, Table2, Timer, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SelectControl } from "../../components/SelectControl";
import { ConfirmDialog, Modal, PageHeader } from "../../components/ui";
import { EMPTY_SCHEMA_CATALOG, schemaCatalogFromRows, type GremlinSchemaCatalog } from "../../lib/gremlin-completion";
import { useTranslate } from "../../lib/i18n";
import { errorMessage } from "../../lib/presentation";
import { SchemaSuggestionInput } from "./SchemaSuggestionInput";
import { friendlyQualitySaveError, validateQualityRuleSet, type QualityValidationIssue, type QualityValidationCode } from "./quality-validation";

export type QualityQueryDraft = {
  title: string;
  connectionId: string;
  graphName: string;
  graphBinding: string;
  graphAccess: "binding" | "configured";
  query: string;
  bindings?: Record<string, unknown>;
};

type Tab = "rules" | "run" | "history";
const QUALITY_HISTORY_RETENTION = 200;
const QUALITY_HISTORY_PAGE_SIZE = 20;
const QUALITY_RULE_SET_PAGE_SIZE = 20;
const kinds: Array<{ value: QualityRuleKind; zh: string; en: string }> = [
  { value: "isolated-vertex", zh: "孤立顶点", en: "Isolated vertices" },
  { value: "duplicate-vertex", zh: "重复候选", en: "Duplicate candidates" },
  { value: "required-property", zh: "必填属性", en: "Required properties" },
  { value: "property-domain", zh: "属性值域", en: "Property domain" },
  { value: "edge-endpoint", zh: "边端点约束", en: "Edge endpoints" },
  { value: "degree-range", zh: "度数异常", en: "Degree range" },
  { value: "distribution", zh: "分布概览", en: "Distribution overview" },
];

const list = (value?: string) => value?.split(",").map((item) => item.trim()).filter(Boolean) ?? [];
const textList = (value?: string[]) => value?.join(", ") ?? "";
const emptyRule = (kind: QualityRuleKind = "isolated-vertex"): QualityRule => ({
  id: crypto.randomUUID(), name: kinds.find((item) => item.value === kind)?.zh ?? kind, kind, enabled: true, severity: kind === "distribution" ? "info" : "warning",
  vertexLabels: [], ignoredEdgeLabels: [], propertyKeys: [], outVertexLabels: [], inVertexLabels: [], direction: "both", minDegree: 0,
  constraint: "not-blank", allowedValues: [], includeVertices: true, includeEdges: true,
});

const QUALITY_SCHEMA_CATALOG_QUERY = `def __catalogBinding = this.getBinding()
def __catalogGraph = null
if (catalogGraphAccess == "configured") {
  __catalogGraph = ConfiguredGraphFactory.open(catalogGraphName)
} else if (__catalogBinding.hasVariable(catalogGraphBinding)) {
  __catalogGraph = __catalogBinding.getVariable(catalogGraphBinding)
} else if (__catalogBinding.hasVariable("g")) {
  def __catalogOptional = __catalogBinding.getVariable("g").getGraph()
  __catalogGraph = __catalogOptional.isPresent() ? __catalogOptional.get() : null
}
if (__catalogGraph == null) { throw new IllegalStateException("Quality target graph is unavailable") }
def __catalogMgmt = __catalogGraph.openManagement()
def __catalogRows = []
try {
  __catalogMgmt.getVertexLabels().each { label -> __catalogRows << [group:"vertexLabels",name:label.name()] }
  __catalogMgmt.getRelationTypes(org.janusgraph.core.EdgeLabel.class).each { label -> __catalogRows << [group:"edgeLabels",name:label.name()] }
  __catalogMgmt.getRelationTypes(org.janusgraph.core.PropertyKey.class).each { key -> __catalogRows << [group:"propertyKeys",name:key.name()] }
  return __catalogRows
} finally {
  if (__catalogMgmt != null && __catalogMgmt.isOpen()) { __catalogMgmt.rollback() }
}`;

function formatTime(value: string) { const date = new Date(value); return Number.isFinite(date.getTime()) ? date.toLocaleString() : value; }
function statusText(status: QualityRun["status"], t: ReturnType<typeof useTranslate>) {
  return status === "succeeded" ? t("已完成", "Completed") : status === "failed" ? t("失败", "Failed") : status === "interrupted" ? t("已中断", "Interrupted") : status === "cancel_requested" ? t("停止中", "Stopping") : t("运行中", "Running");
}
function validationMessage(code: QualityValidationCode, t: ReturnType<typeof useTranslate>): string {
  switch (code) {
    case "name-required": return t("请输入规则集名称", "Enter a rule set name");
    case "graph-name-required": return t("请输入目标图名称", "Enter the target graph name");
    case "graph-binding-required": return t("请输入 Graph Binding", "Enter the Graph Binding");
    case "rule-required": return t("至少添加一条检查规则", "Add at least one check rule");
    case "rule-name-required": return t("请输入规则名称", "Enter a rule name");
    case "vertex-label-required": return t("请选择或输入顶点标签", "Select or enter a vertex label");
    case "duplicate-properties-required": return t("请选择 1–5 个用于判重的属性", "Select 1–5 duplicate-key properties");
    case "required-properties-required": return t("至少选择一个必填属性", "Select at least one required property");
    case "property-domain-required": return t("请选择要检查的属性", "Select a property to inspect");
    case "edge-label-required": return t("请选择或输入边标签", "Select or enter an edge label");
    case "edge-endpoints-required": return t("起点标签和终点标签都至少选择一个", "Select at least one out-label and one in-label");
    case "degree-range-invalid": return t("最大度数不能小于最小度数", "Maximum degree cannot be less than minimum degree");
  }
}

export function QualityPage({ activeConnection, onOpenQuery, requestedRun }: { activeConnection?: ConnectionSummary; onOpenQuery:(draft:QualityQueryDraft)=>void; requestedRun?:{id:string;nonce:number} }) {
  const t = useTranslate();
  const [tab, setTab] = useState<Tab>("rules");
  const [ruleSets, setRuleSets] = useState<QualityRuleSet[]>([]);
  const [runs, setRuns] = useState<QualityRun[]>([]);
  const [selectedRuleSetId, setSelectedRuleSetId] = useState("");
  const [selectedRun, setSelectedRun] = useState<QualityRunDetail>();
  const [baselineRun, setBaselineRun] = useState<QualityRunDetail>();
  const [editing, setEditing] = useState<SaveQualityRuleSetInput>();
  const [expandedResult, setExpandedResult] = useState("");
  const [mode, setMode] = useState<"bounded" | "full">("bounded");
  const [scanLimit, setScanLimit] = useState(10_000);
  const [sampleLimit, setSampleLimit] = useState(50);
  const [timeoutMinutes, setTimeoutMinutes] = useState(60);
  const [busy, setBusy] = useState(false);
  const [savingRuleSet, setSavingRuleSet] = useState(false);
  const [editorError, setEditorError] = useState("");
  const [validationAttempted, setValidationAttempted] = useState(false);
  const [message, setMessage] = useState<{ tone: "error" | "success"; text: string }>();
  const [confirmFull, setConfirmFull] = useState(false);
  const [removingRuleSet, setRemovingRuleSet] = useState<QualityRuleSet>();
  const [removingRun, setRemovingRun] = useState<QualityRun>();
  const [exportTarget, setExportTarget] = useState<QualityRunDetail>();
  const [exportChoice, setExportChoice] = useState<"report" | QualityIssueExportFormat>("csv");
  const [exporting, setExporting] = useState(false);
  const [historyStatus, setHistoryStatus] = useState("");
  const [historyRuleSet, setHistoryRuleSet] = useState("");
  const [historyPage, setHistoryPage] = useState(0);
  const [ruleSetPage, setRuleSetPage] = useState(0);
  const [dynamicGraphs, setDynamicGraphs] = useState<string[]>([]);
  const [loadingGraphs, setLoadingGraphs] = useState(false);
  const [schemaCatalog, setSchemaCatalog] = useState<GremlinSchemaCatalog>(EMPTY_SCHEMA_CATALOG);
  const [schemaCatalogState, setSchemaCatalogState] = useState<"idle"|"loading"|"ready"|"error">("idle");
  const schemaCatalogRequest = useRef(0);
  const selectedRuleSet = ruleSets.find((item) => item.id === selectedRuleSetId) ?? ruleSets[0];
  const validationIssues = useMemo(() => editing ? validateQualityRuleSet(editing) : [], [editing]);
  const validationText = useCallback((issue: QualityValidationIssue) => validationMessage(issue.code, t), [t]);

  const load = useCallback(async () => {
    if (!window.janusGraphDesktop) return;
    const [sets, history] = await Promise.all([
      window.janusGraphDesktop.quality.listRuleSets(activeConnection?.id),
      window.janusGraphDesktop.quality.listRuns({ connectionId: activeConnection?.id, ruleSetId: historyRuleSet || undefined,
        statuses: historyStatus ? [historyStatus as QualityRun["status"]] : undefined, limit: QUALITY_HISTORY_RETENTION }),
    ]);
    setRuleSets(sets); setRuns(history);
    setSelectedRuleSetId((current) => sets.some((item) => item.id === current) ? current : sets[0]?.id ?? "");
    if (selectedRun) {
      const updated = history.find((item) => item.id === selectedRun.id);
      if (updated) setSelectedRun(await window.janusGraphDesktop.quality.getRun(updated.id));
    }
  }, [activeConnection?.id, historyRuleSet, historyStatus, selectedRun?.id]);

  const historyPageCount = Math.max(1, Math.ceil(runs.length / QUALITY_HISTORY_PAGE_SIZE));
  const pagedRuns = useMemo(() => runs.slice(historyPage * QUALITY_HISTORY_PAGE_SIZE, (historyPage + 1) * QUALITY_HISTORY_PAGE_SIZE), [historyPage, runs]);
  const ruleSetPageCount = Math.max(1, Math.ceil(ruleSets.length / QUALITY_RULE_SET_PAGE_SIZE));
  const pagedRuleSets = useMemo(() => ruleSets.slice(ruleSetPage * QUALITY_RULE_SET_PAGE_SIZE, (ruleSetPage + 1) * QUALITY_RULE_SET_PAGE_SIZE), [ruleSetPage, ruleSets]);
  const changeRuleSetPage = (page: number) => {
    const next = Math.max(0, Math.min(ruleSetPageCount - 1, page));
    setRuleSetPage(next);
    setSelectedRuleSetId(ruleSets[next * QUALITY_RULE_SET_PAGE_SIZE]?.id ?? "");
  };

  useEffect(() => { void load().catch((error) => setMessage({ tone: "error", text: errorMessage(error) })); }, [load]);
  useEffect(() => { setHistoryPage(0); }, [activeConnection?.id, historyRuleSet, historyStatus]);
  useEffect(() => { if (historyPage >= historyPageCount) setHistoryPage(historyPageCount - 1); }, [historyPage, historyPageCount]);
  useEffect(() => { setRuleSetPage(0); }, [activeConnection?.id]);
  useEffect(() => { if (ruleSetPage >= ruleSetPageCount) changeRuleSetPage(ruleSetPageCount - 1); }, [ruleSetPage, ruleSetPageCount]);
  useEffect(() => {
    if (!requestedRun || !window.janusGraphDesktop) return;
    setTab("history");
    setBusy(true);
    void window.janusGraphDesktop.quality.getRun(requestedRun.id)
      .then(setSelectedRun)
      .catch((error) => setMessage({ tone:"error", text:errorMessage(error) }))
      .finally(() => setBusy(false));
  }, [requestedRun?.id, requestedRun?.nonce]);
  useEffect(() => {
    if (!runs.some((run) => run.status === "running" || run.status === "cancel_requested")) return;
    const timer = window.setInterval(() => void load(), 1_500); return () => window.clearInterval(timer);
  }, [load, runs]);

  const beginCreate = () => {
    if (!activeConnection) return;
    setEditorError("");
    setValidationAttempted(false);
    setEditing({ name: t("基础质量规则", "Baseline quality rules"), description: "", connectionId: activeConnection.id,
      graphName: activeConnection.graphBinding, graphBinding: activeConnection.graphBinding, graphAccess: "binding",
      rules: [emptyRule("isolated-vertex"), emptyRule("distribution")] });
  };
  const save = async () => {
    if (!editing || savingRuleSet) return;
    setEditorError("");
    setValidationAttempted(true);
    if (validationIssues.length) {
      setEditorError(t(`请修正 ${validationIssues.length} 处配置后再保存`, `Fix ${validationIssues.length} configuration issue(s) before saving`));
      window.requestAnimationFrame(() => document.querySelector(".quality-editor .is-invalid")?.scrollIntoView({ block: "center", behavior: "smooth" }));
      return;
    }
    setSavingRuleSet(true);
    try {
      const saved = await window.janusGraphDesktop!.quality.saveRuleSet(editing);
      setEditing(undefined);
      setRuleSetPage(0);
      setSelectedRuleSetId(saved.id);
      setMessage({ tone: "success", text: t("规则集已保存", "Rule set saved") });
      try {
        await load();
      } catch (error) {
        setMessage({ tone: "error", text: `${t("规则集已保存，但刷新列表失败", "Rule set saved, but the list could not be refreshed")}: ${errorMessage(error)}` });
      }
    } catch (error) {
      setEditorError(friendlyQualitySaveError(error));
    } finally {
      setSavingRuleSet(false);
    }
  };
  const loadDynamicGraphs = useCallback(async () => {
    if (!editing || editing.graphAccess !== "configured") return;
    setLoadingGraphs(true);
    try {
      const result = await window.janusGraphDesktop!.queries.execute({ connectionId: editing.connectionId, consoleId:"quality:targets", executionId:crypto.randomUUID(), query:"ConfiguredGraphFactory.getGraphNames().toList().sort()", bindings:{}, recordHistory:false });
      const values = result.items.length === 1 && Array.isArray(result.items[0]) ? result.items[0] : result.items;
      setDynamicGraphs(values.map(String).filter(Boolean));
    } catch (error) { setMessage({ tone:"error", text:errorMessage(error) }); } finally { setLoadingGraphs(false); }
  }, [editing?.connectionId, editing?.graphAccess]);
  useEffect(() => { if (editing?.graphAccess === "configured") void loadDynamicGraphs(); }, [editing?.graphAccess, loadDynamicGraphs]);
  const loadSchemaCatalog = useCallback(async () => {
    if (!editing || !window.janusGraphDesktop || !editing.graphName.trim() || !editing.graphBinding.trim()) return;
    const request = ++schemaCatalogRequest.current;
    const cacheKey = editing.graphAccess === "configured"
      ? `${editing.connectionId}.${editing.graphName}_traversal`
      : editing.connectionId;
    try {
      const cached = JSON.parse(localStorage.getItem(`janusgraph.schemaCatalog.v1.${cacheKey}`) ?? "null") as GremlinSchemaCatalog | null;
      if (cached && Array.isArray(cached.vertexLabels) && Array.isArray(cached.edgeLabels) && Array.isArray(cached.propertyKeys)) setSchemaCatalog(cached);
    } catch { /* Ignore a stale local cache and refresh from the target graph. */ }
    setSchemaCatalogState("loading");
    try {
      const result = await window.janusGraphDesktop.queries.execute({
        connectionId: editing.connectionId,
        consoleId: "quality:schema-catalog",
        executionId: crypto.randomUUID(),
        query: QUALITY_SCHEMA_CATALOG_QUERY,
        bindings: { catalogGraphAccess:editing.graphAccess, catalogGraphName:editing.graphName, catalogGraphBinding:editing.graphBinding },
        traversalSource: editing.graphAccess === "binding" ? activeConnection?.traversalSource : undefined,
        recordHistory: false,
      });
      if (request !== schemaCatalogRequest.current) return;
      const catalog = schemaCatalogFromRows(result.items);
      setSchemaCatalog(catalog);
      setSchemaCatalogState("ready");
      localStorage.setItem(`janusgraph.schemaCatalog.v1.${cacheKey}`, JSON.stringify(catalog));
    } catch {
      if (request === schemaCatalogRequest.current) setSchemaCatalogState("error");
    }
  }, [activeConnection?.traversalSource, editing?.connectionId, editing?.graphAccess, editing?.graphBinding, editing?.graphName]);
  useEffect(() => {
    if (!editing) {
      schemaCatalogRequest.current += 1;
      setSchemaCatalog(EMPTY_SCHEMA_CATALOG);
      setSchemaCatalogState("idle");
      return;
    }
    const timer = window.setTimeout(() => void loadSchemaCatalog(), 250);
    return () => window.clearTimeout(timer);
  }, [editing?.connectionId, editing?.graphAccess, editing?.graphBinding, editing?.graphName, loadSchemaCatalog]);
  const start = async (confirmed = false) => {
    if (!selectedRuleSet) return;
    if (mode === "full" && activeConnection?.environment === "prod" && !confirmed) { setConfirmFull(true); return; }
    setBusy(true);
    try {
      const run = await window.janusGraphDesktop!.quality.start({ ruleSetId: selectedRuleSet.id, mode, scanLimit: mode === "bounded" ? scanLimit : undefined, sampleLimit, timeoutMs:timeoutMinutes*60_000,
        productionConfirmed: confirmed, confirmedGraphName: confirmed ? selectedRuleSet.graphName : undefined });
      setConfirmFull(false); setTab("history"); await load(); setSelectedRun(await window.janusGraphDesktop!.quality.getRun(run.id));
      window.dispatchEvent(new CustomEvent("janus-studio:background-task", { detail: { open: true } }));
    } catch (error) { setMessage({ tone: "error", text: errorMessage(error) }); } finally { setBusy(false); }
  };
  const openRun = async (run: QualityRun) => { setBusy(true); try { setSelectedRun(await window.janusGraphDesktop!.quality.getRun(run.id)); } finally { setBusy(false); } };
  const exportSelected = async () => {
    if (!exportTarget || exporting) return;
    setExporting(true);
    try {
      let path: string | null;
      let exportedCount = 0;
      if (exportChoice === "report") path = await window.janusGraphDesktop!.quality.exportRun(exportTarget.id);
      else {
        window.dispatchEvent(new CustomEvent("janus-studio:background-task", { detail:{ open:true } }));
        const output = await window.janusGraphDesktop!.quality.exportIssues({ runId:exportTarget.id, format:exportChoice });
        path = output.path;
        exportedCount = output.exportedCount;
      }
      if (path) {
        setMessage({ tone:"success", text:exportChoice === "report" ? t("审计报告已导出", "Audit report exported") : t(`已导出 ${exportedCount.toLocaleString()} 条完整问题数据`, `Exported ${exportedCount.toLocaleString()} complete issue rows`) });
        setExportTarget(undefined);
        window.dispatchEvent(new CustomEvent("janus-studio:background-task", { detail:{ open:true } }));
      }
    } catch (error) { setMessage({ tone:"error", text:errorMessage(error) }); }
    finally { setExporting(false); }
  };
  const previousComparable = useMemo(() => selectedRun ? runs.find((run) => run.ruleSetId === selectedRun.ruleSetId && run.id !== selectedRun.id && run.status === "succeeded" && run.createdAt < selectedRun.createdAt) : undefined, [runs, selectedRun]);
  useEffect(() => {
    let active = true;
    if (!previousComparable) { setBaselineRun(undefined); return; }
    void window.janusGraphDesktop?.quality.getRun(previousComparable.id).then((detail) => { if (active) setBaselineRun(detail); }).catch(() => { if (active) setBaselineRun(undefined); });
    return () => { active = false; };
  }, [previousComparable?.id]);

  return <section className="quality-page">
    <PageHeader eyebrow="DATA QUALITY" title={t("数据质量", "Data Quality")} description={t("使用可审计的只读规则检查静态图与 ConfiguredGraphFactory 动态图。", "Audit static and ConfiguredGraphFactory graphs with traceable read-only rules.")} actions={<button type="button" className="button secondary" onClick={() => void load()}><RefreshCw size={17}/>{t("刷新", "Refresh")}</button>} />
    {!activeConnection && <div className="quality-notice is-warning"><AlertTriangle size={18}/><span>{t("请先选择连接，再配置目标图与规则。", "Select a connection before configuring graph targets and rules.")}</span></div>}
    {message && <div className={`quality-notice is-${message.tone}`}>{message.tone === "error" ? <AlertTriangle size={18}/> : <Check size={18}/>}<span>{message.text}</span><button type="button" aria-label={t("关闭", "Close")} onClick={() => setMessage(undefined)}><X size={17}/></button></div>}
    <div className="quality-tabs" role="tablist">
      {(["rules", "run", "history"] as Tab[]).map((id) => <button type="button" key={id} className={tab === id ? "is-active" : ""} onClick={() => setTab(id)}>{id === "rules" ? t("规则集", "Rule sets") : id === "run" ? t("执行检查", "Run checks") : t("检查历史", "Run history")}</button>)}
    </div>

    {tab === "rules" && <div className="quality-layout">
      <aside className="quality-rule-set-list"><header><div><span>{t("质量策略", "Quality policies")}</span><strong>{ruleSets.length}</strong></div><button className="button primary compact" disabled={!activeConnection} onClick={beginCreate}><Plus size={16}/>{t("新建规则集", "New rule set")}</button></header>
        {pagedRuleSets.map((set) => <button type="button" key={set.id} className={selectedRuleSet?.id === set.id ? "is-active" : ""} onClick={() => setSelectedRuleSetId(set.id)}><strong>{set.name}</strong><span>{set.graphName} · {set.rules.filter((rule) => rule.enabled).length} {t("条规则", "rules")}</span></button>)}
        {!ruleSets.length && <p>{t("尚无规则集。创建后规则会绑定连接与目标图。", "No rule sets yet. New sets are bound to a connection and graph target.")}</p>}
        <footer className="quality-list-pagination"><span>{ruleSets.length?t(`${ruleSetPage*QUALITY_RULE_SET_PAGE_SIZE+1}–${Math.min((ruleSetPage+1)*QUALITY_RULE_SET_PAGE_SIZE,ruleSets.length)} / ${ruleSets.length}`,`${ruleSetPage*QUALITY_RULE_SET_PAGE_SIZE+1}–${Math.min((ruleSetPage+1)*QUALITY_RULE_SET_PAGE_SIZE,ruleSets.length)} / ${ruleSets.length}`):t("暂无规则集","No rule sets")}</span><div><button type="button" aria-label={t("上一页","Previous page")} disabled={ruleSetPage===0} onClick={()=>changeRuleSetPage(ruleSetPage-1)}><ChevronLeft size={16}/></button><span>{ruleSetPage+1} / {ruleSetPageCount}</span><button type="button" aria-label={t("下一页","Next page")} disabled={ruleSetPage+1>=ruleSetPageCount} onClick={()=>changeRuleSetPage(ruleSetPage+1)}><ChevronRight size={16}/></button></div></footer>
      </aside>
      <main className="quality-rule-overview">{selectedRuleSet ? <>
        <header><div><span className="eyebrow">RULE SET</span><h2>{selectedRuleSet.name}</h2><p>{selectedRuleSet.description || t("未填写说明", "No description")}</p></div><div><button className="button secondary" onClick={() => { setEditorError(""); setValidationAttempted(false); setEditing({ ...selectedRuleSet }); }}>{t("编辑", "Edit")}</button><button className="button secondary" onClick={() => { setEditorError(""); setValidationAttempted(false); setEditing({ name:t(`${selectedRuleSet.name} 副本`,`${selectedRuleSet.name} copy`), description:selectedRuleSet.description, connectionId:selectedRuleSet.connectionId, graphName:selectedRuleSet.graphName, graphBinding:selectedRuleSet.graphBinding, graphAccess:selectedRuleSet.graphAccess, rules:selectedRuleSet.rules.map((rule)=>({...rule,id:crypto.randomUUID()})) }); }}>{t("复制", "Duplicate")}</button><button className="button danger ghost" onClick={()=>setRemovingRuleSet(selectedRuleSet)}><Trash2 size={16}/>{t("删除", "Delete")}</button></div></header>
        <div className="quality-target"><ShieldCheck size={20}/><div><span>{t("目标图", "Target graph")}</span><strong>{selectedRuleSet.graphName}</strong></div><code>{selectedRuleSet.graphAccess === "configured" ? "ConfiguredGraphFactory" : selectedRuleSet.graphBinding}</code></div>
        <div className="quality-rule-grid">{selectedRuleSet.rules.map((rule) => <article key={rule.id} className={!rule.enabled ? "is-disabled" : ""}><header><span className={`quality-severity is-${rule.severity}`}/><strong>{rule.name}</strong><small>{kinds.find((item) => item.value === rule.kind)?.[document.documentElement.lang.startsWith("zh") ? "zh" : "en"]}</small></header><p>{rule.enabled ? t("已启用", "Enabled") : t("已停用", "Disabled")}</p></article>)}</div>
      </> : <div className="quality-empty"><Gauge size={32}/><strong>{t("创建第一套质量规则", "Create your first quality policy")}</strong><p>{t("不会自动推断必填或唯一约束，所有检查均由你显式配置。", "Required and unique constraints are never guessed; every check is explicit.")}</p></div>}</main>
    </div>}

    {tab === "run" && <div className="quality-run-panel">
      <header className="quality-run-hero"><div className="quality-run-hero-icon"><BarChart3 size={24}/></div><div><span className="eyebrow">READ-ONLY AUDIT</span><h2>{t("执行质量检查", "Run quality checks")}</h2><p>{t("先确认目标和覆盖范围，再启动可审计的只读任务。", "Confirm the target and coverage before starting a traceable read-only task.")}</p></div><span className="quality-readonly-badge"><ShieldCheck size={15}/>{t("只读执行", "Read-only")}</span></header>
      <div className="quality-run-workbench"><div className="quality-run-config">
        <section className="quality-run-section"><header><span>01</span><div><strong>{t("选择检查目标", "Choose inspection target")}</strong><small>{t("规则集已固定连接、图与规则快照", "The policy fixes the connection, graph, and rule snapshot")}</small></div></header><label><span>{t("规则集", "Rule set")}</span><SelectControl ariaLabel={t("规则集", "Rule set")} value={selectedRuleSet?.id ?? ""} onValueChange={setSelectedRuleSetId} options={ruleSets.map((set) => ({ value:set.id,label:set.name,description:`${set.graphName} · ${set.rules.filter((rule)=>rule.enabled).length}` }))}/></label>{selectedRuleSet&&<div className="quality-run-target"><Database size={17}/><div><span>{selectedRuleSet.graphName}</span><small>{selectedRuleSet.graphAccess === "configured" ? "ConfiguredGraphFactory" : selectedRuleSet.graphBinding}</small></div><strong>{selectedRuleSet.rules.filter((rule)=>rule.enabled).length} {t("条规则", "rules")}</strong></div>}</section>
        <section className="quality-run-section"><header><span>02</span><div><strong>{t("选择覆盖范围", "Choose coverage")}</strong><small>{t("有界用于快速反馈，全量用于完整审计", "Bounded runs provide fast feedback; full runs provide complete audits")}</small></div></header><div className="quality-mode-choice"><button type="button" className={mode === "bounded" ? "is-active" : ""} onClick={() => setMode("bounded")}><ScanSearch size={20}/><strong>{t("有界快速检查", "Bounded quick check")}</strong><span>{t("限制扫描规模，适合日常反馈；不代表全图。", "Limits scan size for daily feedback; never claims full coverage.")}</span></button><button type="button" className={mode === "full" ? "is-active" : ""} onClick={() => setMode("full")}><Layers3 size={20}/><strong>{t("全量检查", "Full audit")}</strong><span>{t("长任务执行，可能对服务端产生持续读取负载。", "Runs as a long task and may create sustained read load.")}</span></button></div></section>
        <section className="quality-run-section"><header><span>03</span><div><strong>{t("设置执行预算", "Set execution budget")}</strong><small>{t("限制样本量和单条规则耗时", "Bound samples and per-rule duration")}</small></div></header><div className="quality-number-row">{mode === "bounded"&&<label><span>{t("扫描上限", "Scan limit")}</span><input type="number" min={1000} max={50000} value={scanLimit} onChange={(event)=>setScanLimit(Number(event.target.value))}/><small>{t("1,000 至 50,000", "1,000 to 50,000")}</small></label>}<label><span>{t("样本上限", "Sample limit")}</span><input type="number" min={1} max={200} value={sampleLimit} onChange={(event)=>setSampleLimit(Number(event.target.value))}/><small>{t("每条规则最多 200 条", "Up to 200 per rule")}</small></label><label><span>{t("单条规则超时（分钟）", "Per-rule timeout (minutes)")}</span><input type="number" min={1} max={1440} value={timeoutMinutes} onChange={(event)=>setTimeoutMinutes(Number(event.target.value))}/><small>{t("最长 24 小时，不修改连接配置", "Up to 24 hours without changing the connection")}</small></label></div></section>
        {mode === "full" && <div className="quality-notice is-warning"><AlertTriangle size={18}/><span>{t("重复候选全量检查仅支持 WS/WSS Sessioned；HTTP/HTTPS 会显示为已跳过，不会发送无界 groupCount。", "Full duplicate checks require WS/WSS Sessioned. HTTP/HTTPS is visibly skipped and never sends unbounded groupCount.")}</span></div>}
      </div><aside className="quality-run-summary"><span className="eyebrow">EXECUTION PLAN</span><h3>{t("本次检查", "This run")}</h3><dl><div><dt><Database size={15}/>{t("目标图", "Target")}</dt><dd>{selectedRuleSet?.graphName ?? "—"}</dd></div><div><dt><ListChecks size={15}/>{t("启用规则", "Enabled rules")}</dt><dd>{selectedRuleSet?.rules.filter((rule)=>rule.enabled).length ?? 0}</dd></div><div><dt><ScanSearch size={15}/>{t("覆盖范围", "Coverage")}</dt><dd>{mode === "bounded" ? t(`最多 ${scanLimit.toLocaleString()} 个元素`, `Up to ${scanLimit.toLocaleString()} elements`) : t("全量", "Full")}</dd></div><div><dt><Eye size={15}/>{t("问题样本", "Issue samples")}</dt><dd>{t(`每条最多 ${sampleLimit} 个`, `Up to ${sampleLimit} each`)}</dd></div><div><dt><Timer size={15}/>{t("规则超时", "Rule timeout")}</dt><dd>{timeoutMinutes} min</dd></div></dl><button className="button primary" disabled={!selectedRuleSet || busy} onClick={() => void start()}>{busy ? <LoaderCircle className="spin" size={17}/> : <Play size={17}/>} {t("开始检查", "Start check")}</button><p>{t("启动后进入任务中心；切换页面不会丢失状态。", "The task continues in Task Center when you leave this page.")}</p></aside></div>
    </div>}

    {tab === "history" && <div className="quality-history-layout"><div className="quality-history-list"><header><div><h2>{t("检查历史", "Run history")}</h2><small>{t("最多保留最近 200 条已结束记录", "Keeps up to the latest 200 completed records")}</small></div><span>{runs.length}</span></header><div className="quality-history-filters"><SelectControl ariaLabel={t("状态筛选","Status filter")} value={historyStatus} onValueChange={setHistoryStatus} options={[{value:"",label:t("全部状态","All statuses")},{value:"running",label:t("运行中","Running")},{value:"succeeded",label:t("已完成","Completed")},{value:"failed",label:t("失败","Failed")},{value:"interrupted",label:t("已中断","Interrupted")}]}/><SelectControl ariaLabel={t("规则集筛选","Rule set filter")} value={historyRuleSet} onValueChange={setHistoryRuleSet} options={[{value:"",label:t("全部规则集","All rule sets")},...ruleSets.map((set)=>({value:set.id,label:set.name}))]}/></div>{pagedRuns.map((run) => <button type="button" key={run.id} className={selectedRun?.id === run.id ? "is-active" : ""} onClick={() => void openRun(run)}><span className={`quality-run-dot is-${run.status}`}/><div><strong>{run.ruleSetName}</strong><span>{run.graphName} · {formatTime(run.createdAt)}</span></div><em>{statusText(run.status,t)}</em></button>)}<footer className="quality-list-pagination"><span>{runs.length?t(`${historyPage*QUALITY_HISTORY_PAGE_SIZE+1}–${Math.min((historyPage+1)*QUALITY_HISTORY_PAGE_SIZE,runs.length)} / ${runs.length}`,`${historyPage*QUALITY_HISTORY_PAGE_SIZE+1}–${Math.min((historyPage+1)*QUALITY_HISTORY_PAGE_SIZE,runs.length)} / ${runs.length}`):t("暂无记录","No records")}</span><div><button type="button" aria-label={t("上一页","Previous page")} disabled={historyPage===0} onClick={()=>setHistoryPage((page)=>Math.max(0,page-1))}><ChevronLeft size={16}/></button><span>{historyPage+1} / {historyPageCount}</span><button type="button" aria-label={t("下一页","Next page")} disabled={historyPage+1>=historyPageCount} onClick={()=>setHistoryPage((page)=>Math.min(historyPageCount-1,page+1))}><ChevronRight size={16}/></button></div></footer></div>
      <main className="quality-run-detail">{selectedRun ? <><header><div><span className="eyebrow">{selectedRun.mode === "bounded" ? "BOUNDED" : "FULL"}</span><h2>{selectedRun.ruleSetName}</h2><p>{selectedRun.message}</p></div><div>{(selectedRun.status === "running" || selectedRun.status === "cancel_requested") && <button className="button danger ghost" disabled={selectedRun.status === "cancel_requested"} onClick={async()=>{await window.janusGraphDesktop!.quality.cancel(selectedRun.id);await load();}}><Square size={15}/>{t("停止", "Stop")}</button>}{(selectedRun.status === "failed" || selectedRun.status === "interrupted") && <button className="button secondary" onClick={async()=>{const next=await window.janusGraphDesktop!.quality.retry(selectedRun.id);await load();await openRun(next);}}><RotateCcw size={16}/>{t("从未完成规则重试", "Retry from incomplete rule")}</button>}<button className="button secondary" onClick={()=>{setExportChoice(selectedRun.issueCount>0?"csv":"report");setExportTarget(selectedRun);}}><FileDown size={16}/>{t("导出", "Export")}</button><button className="button danger ghost" disabled={selectedRun.status==="running"||selectedRun.status==="cancel_requested"} onClick={()=>setRemovingRun(selectedRun)}><Trash2 size={16}/>{t("删除记录", "Delete record")}</button></div></header>
        <div className="quality-metrics"><div><span>{t("问题", "Issues")}</span><strong>{selectedRun.issueCount.toLocaleString()}</strong></div><div><span>{t("已检查", "Checked")}</span><strong>{selectedRun.checkedCount.toLocaleString()}</strong></div><div><span>{t("进度", "Progress")}</span><strong>{selectedRun.currentRule}/{selectedRun.totalRules}</strong></div><div><span>{t("对比基线", "Baseline")}</span><strong>{previousComparable ? `${selectedRun.issueCount-previousComparable.issueCount >= 0 ? "+" : ""}${selectedRun.issueCount-previousComparable.issueCount}` : "—"}</strong></div></div>
        {selectedRun.mode === "bounded" && <div className="quality-notice is-warning"><AlertTriangle size={18}/><span>{t(`本次最多扫描 ${selectedRun.scanLimit.toLocaleString()} 个元素，仅代表有界范围。`, `This run scanned at most ${selectedRun.scanLimit.toLocaleString()} elements and represents bounded coverage only.`)}</span></div>}
        <div className="quality-results">{selectedRun.results.map((result) => <QualityResultCard key={result.id} result={result} run={selectedRun} baseline={baselineRun?.results.find((item) => item.ruleId === result.ruleId)} expanded={expandedResult === result.id} onToggle={() => setExpandedResult(expandedResult === result.id ? "" : result.id)} onOpenQuery={onOpenQuery} t={t}/>)}</div>
      </> : <div className="quality-empty"><BarChart3 size={32}/><strong>{t("选择一条检查记录", "Select a quality run")}</strong><p>{t("可查看规则结果、只读查询、问题样本和历史变化。", "Review rule results, read-only queries, samples, and historical deltas.")}</p></div>}</main></div>}

    {editing && <Modal eyebrow="QUALITY POLICY" title={editing.id ? t("编辑规则集", "Edit rule set") : t("新建规则集", "New rule set")} width="xwide" onClose={()=>setEditing(undefined)}>
      <form className="quality-editor-shell" onSubmit={(event)=>{event.preventDefault();void save();}}>
        <div className="quality-editor">
          <section className="quality-editor-context">
            <div className="quality-editor-grid">
              <label className={validationAttempted&&validationIssues.some((issue)=>issue.field==="name"&&issue.ruleIndex===undefined)?"is-invalid":""}><span>{t("名称", "Name")}</span><input aria-invalid={validationAttempted&&validationIssues.some((issue)=>issue.field==="name"&&issue.ruleIndex===undefined)} value={editing.name} onChange={(e)=>setEditing({...editing,name:e.target.value})}/>{validationAttempted&&validationIssues.find((issue)=>issue.field==="name"&&issue.ruleIndex===undefined)&&<small className="quality-field-error">{validationText(validationIssues.find((issue)=>issue.field==="name"&&issue.ruleIndex===undefined)!)}</small>}</label>
              <label><span>{t("目标类型", "Target type")}</span><SelectControl ariaLabel={t("目标类型", "Target type")} value={editing.graphAccess} onValueChange={(value)=>setEditing({...editing,graphAccess:value as "binding"|"configured"})} options={[{value:"binding",label:t("连接默认图 / 静态绑定", "Connection graph / static binding")},{value:"configured",label:"ConfiguredGraphFactory"}]}/></label>
              <label className={validationAttempted&&validationIssues.some((issue)=>issue.field==="graphName")?"is-invalid":""}><span>{t("图名称", "Graph name")}</span>{editing.graphAccess==="configured"?<div className="quality-graph-picker"><SelectControl ariaLabel={t("动态图", "Dynamic graph")} value={editing.graphName} onValueChange={(value)=>setEditing({...editing,graphName:value,graphBinding:value})} options={dynamicGraphs.length?dynamicGraphs.map((name)=>({value:name,label:name,description:`${name}_traversal`})):[{value:editing.graphName,label:editing.graphName||t("未探测到动态图","No dynamic graphs detected")}]}/><button type="button" className="button secondary compact" disabled={loadingGraphs} onClick={()=>void loadDynamicGraphs()}>{loadingGraphs?<LoaderCircle className="spin" size={15}/>:<RefreshCw size={15}/>}</button></div>:<input aria-invalid={validationAttempted&&validationIssues.some((issue)=>issue.field==="graphName")} value={editing.graphName} onChange={(e)=>setEditing({...editing,graphName:e.target.value})}/>}</label>
              <label className={validationAttempted&&validationIssues.some((issue)=>issue.field==="graphBinding")?"is-invalid":""}><span>{t("Graph Binding", "Graph Binding")}</span><input aria-invalid={validationAttempted&&validationIssues.some((issue)=>issue.field==="graphBinding")} value={editing.graphBinding} onChange={(e)=>setEditing({...editing,graphBinding:e.target.value})}/></label>
            </div>
            <label className="quality-editor-description"><span>{t("说明", "Description")}</span><textarea value={editing.description} onChange={(e)=>setEditing({...editing,description:e.target.value})}/></label>
          </section>
          <section className="quality-editor-rules">
            <header><div><h3>{t("检查规则", "Check rules")}</h3><span>{editing.rules.length}</span></div><div className={`quality-schema-summary is-${schemaCatalogState}`}><span className="quality-schema-summary-icon">{schemaCatalogState==="loading"?<LoaderCircle className="spin" size={15}/>:schemaCatalogState==="error"?<AlertTriangle size={15}/>:<ShieldCheck size={15}/>}</span><strong>{t("Schema 候选", "Schema suggestions")}</strong>{schemaCatalogState==="loading"?<span className="quality-schema-summary-state">{t("正在读取目标图", "Loading target graph")}</span>:schemaCatalogState==="error"?<span className="quality-schema-summary-state">{t("读取失败，可手工输入", "Unavailable; manual input is allowed")}</span>:<div className="quality-schema-summary-metrics"><span>{t("顶点", "Vertex")} <b>{schemaCatalog.vertexLabels.length}</b></span><span>{t("边", "Edge")} <b>{schemaCatalog.edgeLabels.length}</b></span><span>{t("属性", "Property")} <b>{schemaCatalog.propertyKeys.length}</b></span></div>}<button type="button" title={t("重新读取目标图 Schema 候选", "Reload target graph Schema suggestions")} aria-label={t("刷新 Schema 候选", "Refresh Schema suggestions")} onClick={()=>void loadSchemaCatalog()}><RefreshCw size={15}/></button></div><button type="button" className="button secondary compact" onClick={()=>setEditing({...editing,rules:[...editing.rules,emptyRule()]})}><Plus size={15}/>{t("添加规则", "Add rule")}</button></header>
            <div className="quality-rule-editor-list">{editing.rules.map((rule,index)=><RuleEditor key={rule.id} index={index} rule={rule} schemaCatalog={schemaCatalog} issues={validationAttempted?validationIssues.filter((issue)=>issue.ruleIndex===index):[]} t={t} onChange={(next)=>setEditing({...editing,rules:editing.rules.map((item,i)=>i===index?next:item)})} onRemove={()=>setEditing({...editing,rules:editing.rules.filter((_,i)=>i!==index)})}/>)}</div>
          </section>
        </div>
        <footer className="modal-actions">{editorError&&<span className="quality-editor-feedback" role="alert"><AlertTriangle size={15}/>{editorError}</span>}<span className="modal-action-spacer"/><button type="button" className="button secondary" disabled={savingRuleSet} onClick={()=>setEditing(undefined)}>{t("取消", "Cancel")}</button><button type="submit" className="button primary" disabled={savingRuleSet}>{savingRuleSet?<LoaderCircle className="spin" size={16}/>:<Check size={16}/>} {savingRuleSet?t("保存中", "Saving"):t("保存规则集", "Save rule set")}</button></footer>
      </form>
    </Modal>}
    {exportTarget && <Modal eyebrow="QUALITY EXPORT" title={t("导出检查结果", "Export quality results")} width="wide" onClose={()=>!exporting&&setExportTarget(undefined)}>
      <div className="quality-export-dialog">
        <p>{t("CSV 面向业务审阅；JSONL/JSON 面向程序处理。完整问题数据会按本次检查的原规则和覆盖范围重新分页读取，不受页面样本上限影响。", "CSV is intended for business review; JSONL/JSON are for programmatic use. Complete issue data is re-read in pages using the original rules and coverage, independent of the on-screen sample limit.")}</p>
        <div className="quality-export-options">
          {([
            { value:"csv", icon:<Table2 size={20}/>, title:t("完整问题数据 · CSV", "Complete issues · CSV"), detail:t("推荐。含中文列名和 Excel 兼容编码。", "Recommended. Business-friendly columns and Excel-compatible encoding.") },
            { value:"jsonl", icon:<Braces size={20}/>, title:t("完整问题数据 · JSONL", "Complete issues · JSONL"), detail:t("逐行流式写入，适合大量数据和后续处理。", "Streams one object per line for large datasets and pipelines.") },
            { value:"json", icon:<FileJson2 size={20}/>, title:t("完整问题数据 · JSON", "Complete issues · JSON"), detail:t("结构化数组，适合技术人员与系统交换。", "A structured array for technical review and interchange.") },
            { value:"report", icon:<ShieldCheck size={20}/>, title:t("审计报告 · JSON", "Audit report · JSON"), detail:t("保存规则、指标和有限问题快照，不代表全部问题数据。", "Stores rules, metrics, and bounded snapshots; it is not a complete issue export.") },
          ] as const).map((option)=><button type="button" key={option.value} className={exportChoice===option.value?"is-active":""} disabled={option.value!=="report"&&(exportTarget.status!=="succeeded"||exportTarget.issueCount===0)} onClick={()=>setExportChoice(option.value)}>{option.icon}<span><strong>{option.title}</strong><small>{option.detail}</small></span>{exportChoice===option.value&&<Check size={18}/>}</button>)}
        </div>
        {(exportTarget.status!=="succeeded"||exportTarget.issueCount===0)&&<div className="quality-notice is-warning"><AlertTriangle size={17}/><span>{exportTarget.issueCount===0?t("本次没有问题数据可导出；审计报告仍包含检查范围、指标和规则快照。", "This run has no issue rows to export; the audit report still includes scope, metrics, and the rule snapshot."):t("完整问题导出仅适用于已完成检查；当前仍可导出审计报告。", "Complete issue export is available only for completed runs; the audit report remains available.")}</span></div>}
        <footer className="modal-actions"><button type="button" className="button secondary" disabled={exporting} onClick={()=>setExportTarget(undefined)}>{t("取消", "Cancel")}</button><button type="button" className="button primary" disabled={exporting||(exportChoice!=="report"&&(exportTarget.status!=="succeeded"||exportTarget.issueCount===0))} onClick={()=>void exportSelected()}>{exporting?<LoaderCircle className="spin" size={16}/>:<FileDown size={16}/>} {t("导出", "Export")}</button></footer>
      </div>
    </Modal>}
    {confirmFull&&selectedRuleSet&&<ConfirmDialog title={t("确认生产环境全量检查", "Confirm production full audit")} description={t(`请输入完整图名称“${selectedRuleSet.graphName}”。该操作只读，但可能产生持续负载。`, `Type the full graph name “${selectedRuleSet.graphName}”. This is read-only but may create sustained load.`)} confirmationText={selectedRuleSet.graphName} confirmLabel={t("开始全量检查", "Start full audit")} tone="danger" onCancel={()=>setConfirmFull(false)} onConfirm={()=>void start(true)}/>}
    {removingRuleSet&&<ConfirmDialog title={t("删除质量规则集", "Delete quality rule set")} description={t(`请输入完整规则集名称“${removingRuleSet.name}”以确认删除。已固定的历史结果与规则快照会继续保留。`, `Type the full rule set name “${removingRuleSet.name}” to confirm deletion. Existing run results and immutable rule snapshots are retained.`)} confirmationText={removingRuleSet.name} confirmLabel={t("删除规则集", "Delete rule set")} tone="danger" onCancel={()=>setRemovingRuleSet(undefined)} onConfirm={async()=>{try{await window.janusGraphDesktop!.quality.removeRuleSet(removingRuleSet.id);setRemovingRuleSet(undefined);setRuleSetPage(0);await load();}catch(error){setMessage({tone:"error",text:errorMessage(error)});setRemovingRuleSet(undefined);}}}/>}
    {removingRun&&<ConfirmDialog title={t("删除检查历史", "Delete quality history")} description={t("将永久删除本次结果与问题样本，不影响规则集。", "Permanently deletes this run and its samples without changing the rule set.")} confirmLabel={t("删除记录", "Delete record")} tone="danger" onCancel={()=>setRemovingRun(undefined)} onConfirm={async()=>{await window.janusGraphDesktop!.quality.removeRun(removingRun.id);setRemovingRun(undefined);setSelectedRun(undefined);await load();}}/>}
  </section>;
}

function legacyDistribution(value: unknown): Array<{ name: string; count: number }> {
  if (typeof value !== "string") return [];
  return value.replace(/^\{|\}$/g, "").split(",").map((entry) => entry.trim()).filter(Boolean).map((entry) => {
    const separator = entry.lastIndexOf("=");
    return { name: separator < 0 ? entry : entry.slice(0, separator).trim(), count: Number(entry.slice(separator + 1)) || 0 };
  });
}

function DistributionOverview({ samples, t }: { samples: QualitySample[]; t: ReturnType<typeof useTranslate> }) {
  const old = samples.find((sample) => sample.label === "overview");
  const rows = old
    ? [...legacyDistribution(old.values.vertices).map((item)=>({...item,type:"vertex"})), ...legacyDistribution(old.values.edges).map((item)=>({...item,type:"edge"}))]
    : samples.map((sample)=>({ name:String(sample.values.name ?? sample.id), count:Number(sample.values.count ?? 0), type:sample.label }));
  const groups = (["vertex","edge"] as const).map((type)=>({ type, rows:rows.filter((row)=>row.type===type).sort((left,right)=>right.count-left.count) }));
  return <div className="quality-distribution">
    {groups.map((group)=>{const total=group.rows.reduce((sum,row)=>sum+row.count,0);return <section key={group.type}><header><div><span>{group.type==="vertex"?<Database size={17}/>:<Layers3 size={17}/>}<strong>{group.type==="vertex"?t("顶点标签", "Vertex labels"):t("边标签", "Edge labels")}</strong></span><em>{group.rows.length} {t("类", "labels")} · {total.toLocaleString()} {t("个元素", "elements")}</em></div></header>{group.rows.length?<div className="quality-distribution-list">{group.rows.map((row)=>{const ratio=total?row.count/total:0;return <div key={`${group.type}:${row.name}`}><div><strong>{row.name}</strong><span>{row.count.toLocaleString()} · {(ratio*100).toFixed(ratio<0.01?1:0)}%</span></div><i><b style={{width:`${Math.max(ratio*100,1)}%`}}/></i></div>})}</div>:<p>{t("本次未统计该类元素", "No elements of this type were counted")}</p>}</section>})}
  </div>;
}

function qualityRuleScope(rule: QualityRule | undefined, t: ReturnType<typeof useTranslate>): string {
  if (!rule) return t("规则快照不可用", "Rule snapshot unavailable");
  if (rule.kind === "isolated-vertex") return rule.vertexLabels?.length
    ? t(`仅检查顶点标签：${rule.vertexLabels.join("、")}`, `Vertex labels only: ${rule.vertexLabels.join(", ")}`)
    : t("检查全部顶点标签", "All vertex labels");
  if (rule.kind === "distribution") return t(`${rule.includeVertices!==false?"顶点":""}${rule.includeVertices!==false&&rule.includeEdges!==false?" + ":""}${rule.includeEdges!==false?"边":""}标签分布`, `${rule.includeVertices!==false?"Vertex":""}${rule.includeVertices!==false&&rule.includeEdges!==false?" + ":""}${rule.includeEdges!==false?"edge":""} label distribution`);
  if (rule.kind === "edge-endpoint") return t(`边标签：${rule.edgeLabel ?? "—"}`, `Edge label: ${rule.edgeLabel ?? "—"}`);
  return t(`顶点标签：${rule.vertexLabel ?? "—"}`, `Vertex label: ${rule.vertexLabel ?? "—"}`);
}

function QualityResultCard({ result, run, baseline, expanded, onToggle, onOpenQuery, t }: {
  result: QualityRuleResult;
  run: QualityRunDetail;
  baseline?: QualityRuleResult;
  expanded: boolean;
  onToggle: () => void;
  onOpenQuery: (draft: QualityQueryDraft) => void;
  t: ReturnType<typeof useTranslate>;
}) {
  const [showQuery, setShowQuery] = useState(false);
  const [showSamples, setShowSamples] = useState(false);
  const [detailSample, setDetailSample] = useState<QualitySample>();
  const delta = baseline ? result.issueCount - baseline.issueCount : undefined;
  const draft = (query: string, title: string, bindings?: Record<string, unknown>): QualityQueryDraft => ({
    title, query, bindings, connectionId: run.connectionId, graphName: run.graphName,
    graphBinding: run.graphBinding, graphAccess: run.graphAccess,
  });
  const isEdge = result.ruleKind === "edge-endpoint";
  const isDistribution = result.ruleKind === "distribution";
  const ruleSnapshot = run.ruleSetSnapshot.rules.find((rule)=>rule.id===result.ruleId);
  return <article className={`is-${result.status}`}>
    <button type="button" onClick={onToggle}><span className={`quality-severity is-${result.severity}`}/><div><strong>{result.ruleName}</strong><small>{result.message}</small></div><em>{isDistribution?`${result.checkedCount.toLocaleString()} ${t("个元素", "elements")}`:<>{result.issueCount.toLocaleString()} {t("个问题", "issues")}{delta !== undefined && <small className={delta > 0 ? "is-worse" : delta < 0 ? "is-better" : ""}>{t("较上次", "vs previous")} {delta > 0 ? "+" : ""}{delta}</small>}</>}</em>{expanded ? <ChevronUp size={17}/> : <ChevronDown size={17}/>}</button>
    {expanded && <div className="quality-result-expanded">
      <div className="quality-result-scope"><ScanSearch size={15}/><span>{t("规则范围", "Rule scope")}</span><strong>{qualityRuleScope(ruleSnapshot,t)}</strong></div>
      {isDistribution && <DistributionOverview samples={result.samples} t={t}/>}
      {!isDistribution && result.samples.length > 0 && <div className="quality-samples"><header><div><h4>{t("问题样本", "Issue samples")}</h4><span>{result.samples.length} / {result.issueCount.toLocaleString()}</span></div><div className="quality-sample-header-actions"><small>{t("摘要仅展示 cp1、cp2；完整属性可在详情或查询中查看。", "Summaries show cp1 and cp2 only; inspect details or Query for complete properties.")}</small><button type="button" aria-expanded={showSamples} onClick={()=>setShowSamples((current)=>!current)}>{showSamples?<ChevronUp size={15}/>:<ChevronDown size={15}/>}<span>{showSamples?t("收回样本", "Collapse samples"):t("展开样本", "Expand samples")}</span></button></div></header>{showSamples&&<div className="quality-sample-list">{result.samples.map((sample) => {const preview=["cp1","cp2"].flatMap((key)=>Object.prototype.hasOwnProperty.call(sample.values,key)?[[key,sample.values[key]] as const]:[]);return <article key={`${result.id}:${sample.id}`}><div className="quality-sample-identity"><span>{sample.label}</span><code>{String(sample.id)}</code></div><div className="quality-sample-preview">{preview.length?preview.map(([key,value])=><span key={key}><b>{key}</b><code>{value==null?"null":String(value)}</code></span>):<span>{t("未包含 cp1、cp2", "cp1 and cp2 are unavailable")}</span>}</div><button type="button" className="button secondary compact" onClick={()=>setDetailSample(sample)}><Eye size={14}/>{t("查看详情", "View details")}</button></article>})}</div>}</div>}
      {result.query && <div className="quality-query-disclosure"><button type="button" onClick={()=>setShowQuery((current)=>!current)}><Code2 size={15}/><span>{showQuery?t("收起只读 Gremlin", "Hide read-only Gremlin"):t("查看只读 Gremlin", "View read-only Gremlin")}</span>{showQuery?<ChevronUp size={15}/>:<ChevronDown size={15}/>}</button>{showQuery&&<div className="quality-result-query"><header><span>{t("检查实际执行的只读脚本", "Read-only script executed by this check")}</span><div><button type="button" onClick={() => onOpenQuery(draft(result.query, result.ruleName))}><Play size={14}/><span>{t("在查询中打开", "Open in query")}</span></button><button type="button" onClick={() => void navigator.clipboard.writeText(result.query)}><ClipboardCopy size={14}/><span>{t("复制", "Copy")}</span></button></div></header><pre>{result.query}</pre></div>}</div>}
    </div>}
    {detailSample&&<Modal eyebrow="ISSUE SAMPLE" title={`${detailSample.label} · ${String(detailSample.id)}`} width="wide" onClose={()=>setDetailSample(undefined)}><div className="quality-sample-dialog"><p>{t("这是检查执行时保存的属性快照。完整元素可能已发生变化，可在查询工作台重新读取。", "This is the property snapshot captured during the run. The live element may have changed and can be re-read in Query.")}</p>{Object.keys(detailSample.values).length?<dl>{Object.entries(detailSample.values).map(([key,value])=><div key={key}><dt>{key}</dt><dd>{value==null?"null":String(value)}</dd></div>)}</dl>:<div className="quality-empty-sample">{t("本次快照未包含其他属性", "No additional properties were captured in this snapshot")}</div>}<footer className="modal-actions"><button type="button" className="button secondary" onClick={()=>setDetailSample(undefined)}>{t("关闭", "Close")}</button><button type="button" className="button primary" onClick={()=>{onOpenQuery(draft(`${isEdge?"g.E":"g.V"}(qualitySampleId).elementMap()`,`${detailSample.label} · ${String(detailSample.id)}`,{qualitySampleId:detailSample.id}));setDetailSample(undefined);}}><Play size={15}/>{t("在查询中查看完整数据", "View full data in Query")}</button></footer></div></Modal>}
  </article>;
}

function RuleEditor({ index, rule, schemaCatalog, issues, onChange, onRemove, t }: { index:number; rule: QualityRule; schemaCatalog:GremlinSchemaCatalog; issues:QualityValidationIssue[]; onChange:(rule:QualityRule)=>void; onRemove:()=>void; t:ReturnType<typeof useTranslate> }) {
  const set = <K extends keyof QualityRule>(key:K,value:QualityRule[K])=>onChange({...rule,[key]:value});
  const issueFor = (field: QualityValidationIssue["field"]) => issues.find((issue) => issue.field === field);
  const suggestion = (field: QualityValidationIssue["field"], value:string, options:string[], onValueChange:(value:string)=>void, multiple=false) => <SchemaSuggestionInput value={value} options={options} multiple={multiple} invalid={Boolean(issueFor(field))} ariaLabel={t("Schema 候选", "Schema suggestions")} placeholder={t("输入以筛选，或保留自定义值", "Type to filter or keep a custom value")} emptyText={t("没有匹配的 Schema 定义，可按 Enter 保留输入值", "No matching Schema definition; press Enter to keep the typed value")} onChange={onValueChange}/>;
  return <article className={`quality-rule-editor ${rule.enabled?"is-enabled":"is-disabled"} ${issues.length?"is-invalid":""}`}>
    <header>
      <div className="quality-rule-state"><button type="button" className={`quality-toggle ${rule.enabled?"is-on":""}`} onClick={()=>set("enabled",!rule.enabled)} aria-label={t("启用规则", "Enable rule")} aria-pressed={rule.enabled}><i/></button><span>{t("规则", "Rule")} {String(index+1).padStart(2,"0")}</span></div>
      <label className="quality-rule-name"><span>{t("规则名称", "Rule name")}</span><input value={rule.name} onChange={(e)=>set("name",e.target.value)}/></label>
      <button type="button" className="button danger ghost compact quality-rule-remove" aria-label={t("删除规则", "Delete rule")} onClick={onRemove}><Trash2 size={15}/></button>
    </header>
    {issues.length>0&&<div className="quality-rule-errors" role="alert">{issues.map((issue)=><span key={`${issue.code}:${issue.field}`}><AlertTriangle size={14}/>{validationMessage(issue.code,t)}</span>)}</div>}
    <div className="quality-rule-settings">
      <label><span>{t("规则类型", "Rule type")}</span><SelectControl ariaLabel={t("规则类型", "Rule type")} value={rule.kind} onValueChange={(value)=>onChange({...emptyRule(value as QualityRuleKind),id:rule.id,name:rule.name})} options={kinds.map((item)=>({value:item.value,label:t(item.zh,item.en)}))}/></label>
      <label><span>{t("严重级别", "Severity")}</span><SelectControl ariaLabel={t("严重级别", "Severity")} value={rule.severity} onValueChange={(value)=>set("severity",value as QualityRule["severity"])} options={[{value:"info",label:t("信息","Info")},{value:"warning",label:t("警告","Warning")},{value:"error",label:t("错误","Error")}]}/></label>
    </div>
    <div className="quality-rule-fields">
    {(["duplicate-vertex","required-property","property-domain","degree-range"] as QualityRuleKind[]).includes(rule.kind)&&<label><span>{t("顶点标签", "Vertex label")}</span>{suggestion("vertexLabel",rule.vertexLabel??"",schemaCatalog.vertexLabels,(value)=>set("vertexLabel",value))}</label>}
    {rule.kind==="isolated-vertex"&&<><label><span>{t("限定顶点标签", "Vertex labels")}</span>{suggestion("vertexLabels",textList(rule.vertexLabels),schemaCatalog.vertexLabels,(value)=>set("vertexLabels",list(value)),true)}</label><label><span>{t("忽略边标签", "Ignored edge labels")}</span>{suggestion("ignoredEdgeLabels",textList(rule.ignoredEdgeLabels),schemaCatalog.edgeLabels,(value)=>set("ignoredEdgeLabels",list(value)),true)}</label></>}
    {(rule.kind==="duplicate-vertex"||rule.kind==="required-property")&&<label><span>{t(rule.kind==="duplicate-vertex"?"属性组合（1-5 个）":"必填属性",rule.kind==="duplicate-vertex"?"Property tuple (1-5)":"Required properties")}</span>{suggestion("propertyKeys",textList(rule.propertyKeys),schemaCatalog.propertyKeys,(value)=>set("propertyKeys",list(value)),true)}</label>}
    {rule.kind==="duplicate-vertex"&&<label className="quality-check"><input type="checkbox" checked={rule.ignoreMissing??false} onChange={(e)=>set("ignoreMissing",e.target.checked)}/><span>{t("忽略缺失值", "Ignore missing values")}</span></label>}
    {rule.kind==="property-domain"&&<><label><span>{t("属性", "Property")}</span>{suggestion("propertyKey",rule.propertyKey??"",schemaCatalog.propertyKeys,(value)=>set("propertyKey",value))}</label><label><span>{t("约束", "Constraint")}</span><SelectControl ariaLabel={t("约束", "Constraint")} value={rule.constraint} onValueChange={(value)=>set("constraint",value as QualityRule["constraint"])} options={[{value:"not-blank",label:t("非空字符串","Not blank")},{value:"number-range",label:t("数值范围","Number range")},{value:"enum",label:t("枚举集合","Enum set")}]}/></label>{rule.constraint==="number-range"&&<><label><span>{t("最小值","Minimum")}</span><input type="number" value={rule.minimum??0} onChange={(e)=>set("minimum",Number(e.target.value))}/></label><label><span>{t("最大值","Maximum")}</span><input type="number" value={rule.maximum??100} onChange={(e)=>set("maximum",Number(e.target.value))}/></label></>}{rule.constraint==="enum"&&<label><span>{t("允许值（逗号分隔）","Allowed values")}</span><input value={textList(rule.allowedValues)} onChange={(e)=>set("allowedValues",list(e.target.value))}/></label>}</>}
    {rule.kind==="edge-endpoint"&&<><label><span>{t("边标签","Edge label")}</span>{suggestion("edgeLabel",rule.edgeLabel??"",schemaCatalog.edgeLabels,(value)=>set("edgeLabel",value))}</label><label><span>{t("允许的起点标签","Allowed out labels")}</span>{suggestion("outVertexLabels",textList(rule.outVertexLabels),schemaCatalog.vertexLabels,(value)=>set("outVertexLabels",list(value)),true)}</label><label><span>{t("允许的终点标签","Allowed in labels")}</span>{suggestion("inVertexLabels",textList(rule.inVertexLabels),schemaCatalog.vertexLabels,(value)=>set("inVertexLabels",list(value)),true)}</label></>}
    {rule.kind==="degree-range"&&<><label><span>{t("方向","Direction")}</span><SelectControl ariaLabel={t("方向","Direction")} value={rule.direction} onValueChange={(value)=>set("direction",value as QualityRule["direction"])} options={[{value:"both",label:t("双向","Both")},{value:"in",label:t("入度","In")},{value:"out",label:t("出度","Out")}]}/></label><label><span>{t("边标签（可选）","Edge label (optional)")}</span>{suggestion("edgeLabel",rule.edgeLabel??"",schemaCatalog.edgeLabels,(value)=>set("edgeLabel",value))}</label><label><span>{t("最小度数","Minimum degree")}</span><input type="number" min={0} value={rule.minDegree??0} onChange={(e)=>set("minDegree",Number(e.target.value))}/></label><label><span>{t("最大度数","Maximum degree")}</span><input aria-invalid={Boolean(issueFor("maxDegree"))} type="number" min={0} value={rule.maxDegree??100} onChange={(e)=>set("maxDegree",Number(e.target.value))}/></label></>}
    {rule.kind==="distribution"&&<><label className="quality-check"><input type="checkbox" checked={rule.includeVertices!==false} onChange={(e)=>set("includeVertices",e.target.checked)}/><span>{t("顶点标签分布","Vertex label distribution")}</span></label><label className="quality-check"><input type="checkbox" checked={rule.includeEdges!==false} onChange={(e)=>set("includeEdges",e.target.checked)}/><span>{t("边标签分布","Edge label distribution")}</span></label></>}
    </div>
  </article>;
}
