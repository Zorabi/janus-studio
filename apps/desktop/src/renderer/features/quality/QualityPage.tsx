import type { ConnectionSummary, QualityRule, QualityRuleKind, QualityRuleSet, QualityRun, QualityRunDetail, SaveQualityRuleSetInput } from "@janusgraph/domain";
import { AlertTriangle, BarChart3, Check, ChevronDown, ChevronUp, ClipboardCopy, FileDown, Gauge, LoaderCircle, Play, Plus, RefreshCw, RotateCcw, ShieldCheck, Square, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { SelectControl } from "../../components/SelectControl";
import { ConfirmDialog, Modal, PageHeader } from "../../components/ui";
import { useTranslate } from "../../lib/i18n";
import { errorMessage } from "../../lib/presentation";

type Tab = "rules" | "run" | "history";
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

function formatTime(value: string) { const date = new Date(value); return Number.isFinite(date.getTime()) ? date.toLocaleString() : value; }
function statusText(status: QualityRun["status"], t: ReturnType<typeof useTranslate>) {
  return status === "succeeded" ? t("已完成", "Completed") : status === "failed" ? t("失败", "Failed") : status === "interrupted" ? t("已中断", "Interrupted") : status === "cancel_requested" ? t("停止中", "Stopping") : t("运行中", "Running");
}

export function QualityPage({ activeConnection, onOpenQuery, requestedRun }: { activeConnection?: ConnectionSummary; onOpenQuery:(query:string)=>void; requestedRun?:{id:string;nonce:number} }) {
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
  const [message, setMessage] = useState<{ tone: "error" | "success"; text: string }>();
  const [confirmFull, setConfirmFull] = useState(false);
  const [removingRuleSet, setRemovingRuleSet] = useState<QualityRuleSet>();
  const [removingRun, setRemovingRun] = useState<QualityRun>();
  const [historyStatus, setHistoryStatus] = useState("");
  const [historyRuleSet, setHistoryRuleSet] = useState("");
  const [historyLimit, setHistoryLimit] = useState(() => Number(localStorage.getItem("janusgraph.quality.historyLimit") ?? 200));
  const [dynamicGraphs, setDynamicGraphs] = useState<string[]>([]);
  const [loadingGraphs, setLoadingGraphs] = useState(false);
  const selectedRuleSet = ruleSets.find((item) => item.id === selectedRuleSetId) ?? ruleSets[0];

  const load = useCallback(async () => {
    if (!window.janusGraphDesktop) return;
    const [sets, history] = await Promise.all([
      window.janusGraphDesktop.quality.listRuleSets(activeConnection?.id),
      window.janusGraphDesktop.quality.listRuns({ connectionId: activeConnection?.id, ruleSetId: historyRuleSet || undefined,
        statuses: historyStatus ? [historyStatus as QualityRun["status"]] : undefined, limit: historyLimit }),
    ]);
    setRuleSets(sets); setRuns(history);
    setSelectedRuleSetId((current) => sets.some((item) => item.id === current) ? current : sets[0]?.id ?? "");
    if (selectedRun) {
      const updated = history.find((item) => item.id === selectedRun.id);
      if (updated) setSelectedRun(await window.janusGraphDesktop.quality.getRun(updated.id));
    }
  }, [activeConnection?.id, historyLimit, historyRuleSet, historyStatus, selectedRun?.id]);

  useEffect(() => { void load().catch((error) => setMessage({ tone: "error", text: errorMessage(error) })); }, [load]);
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
    setEditing({ name: t("基础质量规则", "Baseline quality rules"), description: "", connectionId: activeConnection.id,
      graphName: activeConnection.graphBinding, graphBinding: activeConnection.graphBinding, graphAccess: "binding",
      rules: [emptyRule("isolated-vertex"), emptyRule("distribution")] });
  };
  const save = async () => {
    if (!editing) return; setBusy(true);
    try { const saved = await window.janusGraphDesktop!.quality.saveRuleSet(editing); setEditing(undefined); await load(); setSelectedRuleSetId(saved.id); setMessage({ tone: "success", text: t("规则集已保存", "Rule set saved") }); }
    catch (error) { setMessage({ tone: "error", text: errorMessage(error) }); } finally { setBusy(false); }
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
    {message && <div className={`quality-notice is-${message.tone}`}><ShieldCheck size={18}/><span>{message.text}</span><button onClick={() => setMessage(undefined)}>×</button></div>}
    <div className="quality-tabs" role="tablist">
      {(["rules", "run", "history"] as Tab[]).map((id) => <button type="button" key={id} className={tab === id ? "is-active" : ""} onClick={() => setTab(id)}>{id === "rules" ? t("规则集", "Rule sets") : id === "run" ? t("执行检查", "Run checks") : t("检查历史", "Run history")}</button>)}
    </div>

    {tab === "rules" && <div className="quality-layout">
      <aside className="quality-rule-set-list"><header><div><span>{t("质量策略", "Quality policies")}</span><strong>{ruleSets.length}</strong></div><button className="button primary compact" disabled={!activeConnection} onClick={beginCreate}><Plus size={16}/>{t("新建规则集", "New rule set")}</button></header>
        {ruleSets.map((set) => <button type="button" key={set.id} className={selectedRuleSet?.id === set.id ? "is-active" : ""} onClick={() => setSelectedRuleSetId(set.id)}><strong>{set.name}</strong><span>{set.graphName} · {set.rules.filter((rule) => rule.enabled).length} {t("条规则", "rules")}</span></button>)}
        {!ruleSets.length && <p>{t("尚无规则集。创建后规则会绑定连接与目标图。", "No rule sets yet. New sets are bound to a connection and graph target.")}</p>}
      </aside>
      <main className="quality-rule-overview">{selectedRuleSet ? <>
        <header><div><span className="eyebrow">RULE SET</span><h2>{selectedRuleSet.name}</h2><p>{selectedRuleSet.description || t("未填写说明", "No description")}</p></div><div><button className="button secondary" onClick={() => setEditing({ ...selectedRuleSet })}>{t("编辑", "Edit")}</button><button className="button secondary" onClick={() => setEditing({ name:t(`${selectedRuleSet.name} 副本`,`${selectedRuleSet.name} copy`), description:selectedRuleSet.description, connectionId:selectedRuleSet.connectionId, graphName:selectedRuleSet.graphName, graphBinding:selectedRuleSet.graphBinding, graphAccess:selectedRuleSet.graphAccess, rules:selectedRuleSet.rules.map((rule)=>({...rule,id:crypto.randomUUID()})) })}>{t("复制", "Duplicate")}</button><button className="button danger ghost" onClick={()=>setRemovingRuleSet(selectedRuleSet)}><Trash2 size={16}/>{t("删除", "Delete")}</button></div></header>
        <div className="quality-target"><ShieldCheck size={20}/><div><span>{t("目标图", "Target graph")}</span><strong>{selectedRuleSet.graphName}</strong></div><code>{selectedRuleSet.graphAccess === "configured" ? "ConfiguredGraphFactory" : selectedRuleSet.graphBinding}</code></div>
        <div className="quality-rule-grid">{selectedRuleSet.rules.map((rule) => <article key={rule.id} className={!rule.enabled ? "is-disabled" : ""}><header><span className={`quality-severity is-${rule.severity}`}/><strong>{rule.name}</strong><small>{kinds.find((item) => item.value === rule.kind)?.[document.documentElement.lang.startsWith("zh") ? "zh" : "en"]}</small></header><p>{rule.enabled ? t("已启用", "Enabled") : t("已停用", "Disabled")}</p></article>)}</div>
      </> : <div className="quality-empty"><Gauge size={32}/><strong>{t("创建第一套质量规则", "Create your first quality policy")}</strong><p>{t("不会自动推断必填或唯一约束，所有检查均由你显式配置。", "Required and unique constraints are never guessed; every check is explicit.")}</p></div>}</main>
    </div>}

    {tab === "run" && <div className="quality-run-panel">
      <div className="quality-run-config"><header><BarChart3 size={22}/><div><h2>{t("执行质量检查", "Run quality checks")}</h2><p>{t("检查只执行只读 Gremlin，不会修改数据或 Schema。", "Checks execute read-only Gremlin and never modify data or Schema.")}</p></div></header>
        <label><span>{t("规则集", "Rule set")}</span><SelectControl ariaLabel={t("规则集", "Rule set")} value={selectedRuleSet?.id ?? ""} onValueChange={setSelectedRuleSetId} options={ruleSets.map((set) => ({ value:set.id,label:set.name,description:`${set.graphName} · ${set.rules.filter((rule)=>rule.enabled).length}` }))}/></label>
        <div className="quality-mode-choice"><button type="button" className={mode === "bounded" ? "is-active" : ""} onClick={() => setMode("bounded")}><strong>{t("有界快速检查", "Bounded quick check")}</strong><span>{t("限制扫描规模，适合日常反馈；不代表全图。", "Limits scan size for daily feedback; never claims full coverage.")}</span></button><button type="button" className={mode === "full" ? "is-active" : ""} onClick={() => setMode("full")}><strong>{t("全量检查", "Full audit")}</strong><span>{t("长任务执行，可能对服务端产生持续读取负载。", "Runs as a long task and may create sustained read load.")}</span></button></div>
        <div className="quality-number-row">{mode === "bounded"&&<><label><span>{t("扫描上限", "Scan limit")}</span><input type="number" min={1000} max={50000} value={scanLimit} onChange={(event)=>setScanLimit(Number(event.target.value))}/><small>{t("1,000 至 50,000", "1,000 to 50,000")}</small></label><label><span>{t("样本上限", "Sample limit")}</span><input type="number" min={1} max={200} value={sampleLimit} onChange={(event)=>setSampleLimit(Number(event.target.value))}/><small>{t("每条规则最多 200 条", "Up to 200 per rule")}</small></label></>}<label><span>{t("单条规则超时（分钟）", "Per-rule timeout (minutes)")}</span><input type="number" min={1} max={1440} value={timeoutMinutes} onChange={(event)=>setTimeoutMinutes(Number(event.target.value))}/><small>{t("最长 24 小时，不修改连接配置", "Up to 24 hours without changing the connection")}</small></label></div>
        {mode === "full" && <div className="quality-notice is-warning"><AlertTriangle size={18}/><span>{t("重复候选全量检查仅支持 WS/WSS Sessioned；HTTP/HTTPS 会显示为已跳过，不会发送无界 groupCount。", "Full duplicate checks require WS/WSS Sessioned. HTTP/HTTPS is visibly skipped and never sends unbounded groupCount.")}</span></div>}
        <footer><button className="button primary" disabled={!selectedRuleSet || busy} onClick={() => void start()}>{busy ? <LoaderCircle className="spin" size={17}/> : <Play size={17}/>} {t("开始检查", "Start check")}</button></footer>
      </div>
    </div>}

    {tab === "history" && <div className="quality-history-layout"><div className="quality-history-list"><header><h2>{t("检查历史", "Run history")}</h2><span>{runs.length} / {historyLimit}</span></header><div className="quality-history-filters"><SelectControl ariaLabel={t("状态筛选","Status filter")} value={historyStatus} onValueChange={setHistoryStatus} options={[{value:"",label:t("全部状态","All statuses")},{value:"running",label:t("运行中","Running")},{value:"succeeded",label:t("已完成","Completed")},{value:"failed",label:t("失败","Failed")},{value:"interrupted",label:t("已中断","Interrupted")}]}/><SelectControl ariaLabel={t("规则集筛选","Rule set filter")} value={historyRuleSet} onValueChange={setHistoryRuleSet} options={[{value:"",label:t("全部规则集","All rule sets")},...ruleSets.map((set)=>({value:set.id,label:set.name}))]}/><SelectControl ariaLabel={t("保留显示数量","History display limit")} value={String(historyLimit)} onValueChange={(value)=>{const next=Number(value);setHistoryLimit(next);localStorage.setItem("janusgraph.quality.historyLimit",String(next));}} options={[50,100,200].map((value)=>({value:String(value),label:t(`最近 ${value} 条`,`Latest ${value}`)}))}/></div>{runs.map((run) => <button type="button" key={run.id} className={selectedRun?.id === run.id ? "is-active" : ""} onClick={() => void openRun(run)}><span className={`quality-run-dot is-${run.status}`}/><div><strong>{run.ruleSetName}</strong><span>{run.graphName} · {formatTime(run.createdAt)}</span></div><em>{statusText(run.status,t)}</em></button>)}</div>
      <main className="quality-run-detail">{selectedRun ? <><header><div><span className="eyebrow">{selectedRun.mode === "bounded" ? "BOUNDED" : "FULL"}</span><h2>{selectedRun.ruleSetName}</h2><p>{selectedRun.message}</p></div><div>{(selectedRun.status === "running" || selectedRun.status === "cancel_requested") && <button className="button danger ghost" disabled={selectedRun.status === "cancel_requested"} onClick={async()=>{await window.janusGraphDesktop!.quality.cancel(selectedRun.id);await load();}}><Square size={15}/>{t("停止", "Stop")}</button>}{(selectedRun.status === "failed" || selectedRun.status === "interrupted") && <button className="button secondary" onClick={async()=>{const next=await window.janusGraphDesktop!.quality.retry(selectedRun.id);await load();await openRun(next);}}><RotateCcw size={16}/>{t("从未完成规则重试", "Retry from incomplete rule")}</button>}<button className="button secondary" onClick={()=>void window.janusGraphDesktop!.quality.exportRun(selectedRun.id)}><FileDown size={16}/>{t("导出报告", "Export report")}</button><button className="button danger ghost" onClick={()=>setRemovingRun(selectedRun)}><Trash2 size={16}/></button></div></header>
        <div className="quality-metrics"><div><span>{t("问题", "Issues")}</span><strong>{selectedRun.issueCount.toLocaleString()}</strong></div><div><span>{t("已检查", "Checked")}</span><strong>{selectedRun.checkedCount.toLocaleString()}</strong></div><div><span>{t("进度", "Progress")}</span><strong>{selectedRun.currentRule}/{selectedRun.totalRules}</strong></div><div><span>{t("对比基线", "Baseline")}</span><strong>{previousComparable ? `${selectedRun.issueCount-previousComparable.issueCount >= 0 ? "+" : ""}${selectedRun.issueCount-previousComparable.issueCount}` : "—"}</strong></div></div>
        {selectedRun.mode === "bounded" && <div className="quality-notice is-warning"><AlertTriangle size={18}/><span>{t(`本次最多扫描 ${selectedRun.scanLimit.toLocaleString()} 个元素，仅代表有界范围。`, `This run scanned at most ${selectedRun.scanLimit.toLocaleString()} elements and represents bounded coverage only.`)}</span></div>}
        <div className="quality-results">{selectedRun.results.map((result)=>{const baseline=baselineRun?.results.find((item)=>item.ruleId===result.ruleId);const delta=baseline?result.issueCount-baseline.issueCount:undefined;return <article key={result.id} className={`is-${result.status}`}><button type="button" onClick={()=>setExpandedResult(expandedResult===result.id?"":result.id)}><span className={`quality-severity is-${result.severity}`}/><div><strong>{result.ruleName}</strong><small>{result.message}</small></div><em>{result.issueCount.toLocaleString()} {t("个问题", "issues")}{delta!==undefined&&<small className={delta>0?"is-worse":delta<0?"is-better":""}>{t("较上次", "vs previous")} {delta>0?"+":""}{delta}</small>}</em>{expandedResult===result.id?<ChevronUp size={17}/>:<ChevronDown size={17}/>}</button>{expandedResult===result.id&&<div className="quality-result-expanded"><div className="quality-result-query"><header><span>{t("只读 Gremlin", "Read-only Gremlin")}</span><div>{result.query&&<button onClick={()=>onOpenQuery(result.query)}><Play size={14}/>{t("在查询中打开", "Open in query")}</button>}<button onClick={()=>void navigator.clipboard.writeText(result.query)}><ClipboardCopy size={14}/>{t("复制", "Copy")}</button></div></header><pre>{result.query||result.message}</pre></div>{result.samples.length>0&&<div className="quality-samples"><h4>{t("问题样本", "Issue samples")}</h4>{result.samples.map((sample)=><div key={`${result.id}:${sample.id}`}><code>{sample.label} · {sample.id}</code><span>{Object.entries(sample.values).map(([key,value])=>`${key}: ${String(value)}`).join(" · ")}</span></div>)}</div>}</div>}</article>;})}</div>
      </> : <div className="quality-empty"><BarChart3 size={32}/><strong>{t("选择一条检查记录", "Select a quality run")}</strong><p>{t("可查看规则结果、只读查询、问题样本和历史变化。", "Review rule results, read-only queries, samples, and historical deltas.")}</p></div>}</main></div>}

    {editing && <Modal eyebrow="QUALITY POLICY" title={editing.id ? t("编辑规则集", "Edit rule set") : t("新建规则集", "New rule set")} width="wide" onClose={()=>setEditing(undefined)}><div className="quality-editor"><div className="quality-editor-grid"><label><span>{t("名称", "Name")}</span><input value={editing.name} onChange={(e)=>setEditing({...editing,name:e.target.value})}/></label><label><span>{t("目标类型", "Target type")}</span><SelectControl ariaLabel={t("目标类型", "Target type")} value={editing.graphAccess} onValueChange={(value)=>setEditing({...editing,graphAccess:value as "binding"|"configured"})} options={[{value:"binding",label:t("连接默认图 / 静态绑定", "Connection graph / static binding")},{value:"configured",label:"ConfiguredGraphFactory"}]}/></label><label><span>{t("图名称", "Graph name")}</span>{editing.graphAccess==="configured"?<div className="quality-graph-picker"><SelectControl ariaLabel={t("动态图", "Dynamic graph")} value={editing.graphName} onValueChange={(value)=>setEditing({...editing,graphName:value,graphBinding:value})} options={dynamicGraphs.length?dynamicGraphs.map((name)=>({value:name,label:name,description:`${name}_traversal`})):[{value:editing.graphName,label:editing.graphName||t("未探测到动态图","No dynamic graphs detected")}]}/><button type="button" className="button secondary compact" disabled={loadingGraphs} onClick={()=>void loadDynamicGraphs()}>{loadingGraphs?<LoaderCircle className="spin" size={15}/>:<RefreshCw size={15}/>}</button></div>:<input value={editing.graphName} onChange={(e)=>setEditing({...editing,graphName:e.target.value})}/>}</label><label><span>{t("Graph Binding", "Graph Binding")}</span><input value={editing.graphBinding} onChange={(e)=>setEditing({...editing,graphBinding:e.target.value})}/></label></div><label><span>{t("说明", "Description")}</span><textarea value={editing.description} onChange={(e)=>setEditing({...editing,description:e.target.value})}/></label>
        <div className="quality-editor-rules"><header><div><h3>{t("检查规则", "Check rules")}</h3><span>{editing.rules.length}</span></div><button className="button secondary compact" onClick={()=>setEditing({...editing,rules:[...editing.rules,emptyRule()]})}><Plus size={15}/>{t("添加规则", "Add rule")}</button></header>{editing.rules.map((rule,index)=><RuleEditor key={rule.id} rule={rule} t={t} onChange={(next)=>setEditing({...editing,rules:editing.rules.map((item,i)=>i===index?next:item)})} onRemove={()=>setEditing({...editing,rules:editing.rules.filter((_,i)=>i!==index)})}/>)}</div>
      </div><footer className="modal-actions"><button className="button secondary" onClick={()=>setEditing(undefined)}>{t("取消", "Cancel")}</button><button className="button primary" disabled={busy||!editing.name.trim()||!editing.rules.length} onClick={()=>void save()}><Check size={16}/>{t("保存规则集", "Save rule set")}</button></footer></Modal>}
    {confirmFull&&selectedRuleSet&&<ConfirmDialog title={t("确认生产环境全量检查", "Confirm production full audit")} description={t(`请输入完整图名称“${selectedRuleSet.graphName}”。该操作只读，但可能产生持续负载。`, `Type the full graph name “${selectedRuleSet.graphName}”. This is read-only but may create sustained load.`)} confirmationText={selectedRuleSet.graphName} confirmLabel={t("开始全量检查", "Start full audit")} tone="danger" onCancel={()=>setConfirmFull(false)} onConfirm={()=>void start(true)}/>} 
    {removingRuleSet&&<ConfirmDialog title={t("删除质量规则集", "Delete quality rule set")} description={t(`将删除“${removingRuleSet.name}”。已固定的历史结果与规则快照会继续保留。`, `Delete “${removingRuleSet.name}”. Existing run results and immutable rule snapshots are retained.`)} confirmLabel={t("删除规则集", "Delete rule set")} tone="danger" onCancel={()=>setRemovingRuleSet(undefined)} onConfirm={async()=>{try{await window.janusGraphDesktop!.quality.removeRuleSet(removingRuleSet.id);setRemovingRuleSet(undefined);await load();}catch(error){setMessage({tone:"error",text:errorMessage(error)});setRemovingRuleSet(undefined);}}}/>} 
    {removingRun&&<ConfirmDialog title={t("删除检查历史", "Delete quality history")} description={t("将永久删除本次结果与问题样本，不影响规则集。", "Permanently deletes this run and its samples without changing the rule set.")} confirmLabel={t("删除记录", "Delete record")} tone="danger" onCancel={()=>setRemovingRun(undefined)} onConfirm={async()=>{await window.janusGraphDesktop!.quality.removeRun(removingRun.id);setRemovingRun(undefined);setSelectedRun(undefined);await load();}}/>}
  </section>;
}

function RuleEditor({ rule, onChange, onRemove, t }: { rule: QualityRule; onChange:(rule:QualityRule)=>void; onRemove:()=>void; t:ReturnType<typeof useTranslate> }) {
  const set = <K extends keyof QualityRule>(key:K,value:QualityRule[K])=>onChange({...rule,[key]:value});
  return <article className="quality-rule-editor"><header><button type="button" className={`quality-toggle ${rule.enabled?"is-on":""}`} onClick={()=>set("enabled",!rule.enabled)} aria-label={t("启用规则", "Enable rule")}><i/></button><input value={rule.name} onChange={(e)=>set("name",e.target.value)}/><SelectControl ariaLabel={t("规则类型", "Rule type")} value={rule.kind} onValueChange={(value)=>onChange({...emptyRule(value as QualityRuleKind),id:rule.id,name:rule.name})} options={kinds.map((item)=>({value:item.value,label:t(item.zh,item.en)}))}/><SelectControl ariaLabel={t("严重级别", "Severity")} value={rule.severity} onValueChange={(value)=>set("severity",value as QualityRule["severity"])} options={[{value:"info",label:t("信息","Info")},{value:"warning",label:t("警告","Warning")},{value:"error",label:t("错误","Error")}]}/><button className="button danger ghost compact" onClick={onRemove}><Trash2 size={15}/></button></header><div className="quality-rule-fields">
    {(["duplicate-vertex","required-property","property-domain","degree-range"] as QualityRuleKind[]).includes(rule.kind)&&<label><span>{t("顶点标签", "Vertex label")}</span><input value={rule.vertexLabel??""} onChange={(e)=>set("vertexLabel",e.target.value)}/></label>}
    {rule.kind==="isolated-vertex"&&<><label><span>{t("限定顶点标签（逗号分隔）", "Vertex labels (comma-separated)")}</span><input value={textList(rule.vertexLabels)} onChange={(e)=>set("vertexLabels",list(e.target.value))}/></label><label><span>{t("忽略边标签", "Ignored edge labels")}</span><input value={textList(rule.ignoredEdgeLabels)} onChange={(e)=>set("ignoredEdgeLabels",list(e.target.value))}/></label></>}
    {(rule.kind==="duplicate-vertex"||rule.kind==="required-property")&&<label><span>{t(rule.kind==="duplicate-vertex"?"属性组合（1-5 个）":"必填属性（逗号分隔）",rule.kind==="duplicate-vertex"?"Property tuple (1-5)":"Required properties")}</span><input value={textList(rule.propertyKeys)} onChange={(e)=>set("propertyKeys",list(e.target.value))}/></label>}
    {rule.kind==="duplicate-vertex"&&<label className="quality-check"><input type="checkbox" checked={rule.ignoreMissing??false} onChange={(e)=>set("ignoreMissing",e.target.checked)}/><span>{t("忽略缺失值", "Ignore missing values")}</span></label>}
    {rule.kind==="property-domain"&&<><label><span>{t("属性", "Property")}</span><input value={rule.propertyKey??""} onChange={(e)=>set("propertyKey",e.target.value)}/></label><label><span>{t("约束", "Constraint")}</span><SelectControl ariaLabel={t("约束", "Constraint")} value={rule.constraint} onValueChange={(value)=>set("constraint",value as QualityRule["constraint"])} options={[{value:"not-blank",label:t("非空字符串","Not blank")},{value:"number-range",label:t("数值范围","Number range")},{value:"enum",label:t("枚举集合","Enum set")}]}/></label>{rule.constraint==="number-range"&&<><label><span>{t("最小值","Minimum")}</span><input type="number" value={rule.minimum??0} onChange={(e)=>set("minimum",Number(e.target.value))}/></label><label><span>{t("最大值","Maximum")}</span><input type="number" value={rule.maximum??100} onChange={(e)=>set("maximum",Number(e.target.value))}/></label></>}{rule.constraint==="enum"&&<label><span>{t("允许值（逗号分隔）","Allowed values")}</span><input value={textList(rule.allowedValues)} onChange={(e)=>set("allowedValues",list(e.target.value))}/></label>}</>}
    {rule.kind==="edge-endpoint"&&<><label><span>{t("边标签","Edge label")}</span><input value={rule.edgeLabel??""} onChange={(e)=>set("edgeLabel",e.target.value)}/></label><label><span>{t("允许的起点标签","Allowed out labels")}</span><input value={textList(rule.outVertexLabels)} onChange={(e)=>set("outVertexLabels",list(e.target.value))}/></label><label><span>{t("允许的终点标签","Allowed in labels")}</span><input value={textList(rule.inVertexLabels)} onChange={(e)=>set("inVertexLabels",list(e.target.value))}/></label></>}
    {rule.kind==="degree-range"&&<><label><span>{t("方向","Direction")}</span><SelectControl ariaLabel={t("方向","Direction")} value={rule.direction} onValueChange={(value)=>set("direction",value as QualityRule["direction"])} options={[{value:"both",label:t("双向","Both")},{value:"in",label:t("入度","In")},{value:"out",label:t("出度","Out")}]}/></label><label><span>{t("边标签（可选）","Edge label (optional)")}</span><input value={rule.edgeLabel??""} onChange={(e)=>set("edgeLabel",e.target.value)}/></label><label><span>{t("最小度数","Minimum degree")}</span><input type="number" min={0} value={rule.minDegree??0} onChange={(e)=>set("minDegree",Number(e.target.value))}/></label><label><span>{t("最大度数","Maximum degree")}</span><input type="number" min={0} value={rule.maxDegree??100} onChange={(e)=>set("maxDegree",Number(e.target.value))}/></label></>}
    {rule.kind==="distribution"&&<><label className="quality-check"><input type="checkbox" checked={rule.includeVertices!==false} onChange={(e)=>set("includeVertices",e.target.checked)}/><span>{t("顶点标签分布","Vertex label distribution")}</span></label><label className="quality-check"><input type="checkbox" checked={rule.includeEdges!==false} onChange={(e)=>set("includeEdges",e.target.checked)}/><span>{t("边标签分布","Edge label distribution")}</span></label></>}
  </div></article>;
}
