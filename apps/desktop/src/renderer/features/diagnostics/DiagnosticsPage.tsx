import type {
  DiagnosticIncidentContext,
  DiagnosticBundleInspectionResult,
  DiagnosticRecord,
  DiagnosticRecordStatus,
  DiagnosticLogLevel,
  DiagnosticLogSource,
  DiagnosticPreviewSnapshot,
} from "@janusgraph/domain";
import {
  AlertTriangle,
  Archive,
  Check,
  CheckCircle2,
  Clipboard,
  FileCode2,
  FileJson2,
  FileText,
  FolderSearch,
  Fingerprint,
  LoaderCircle,
  LockKeyhole,
  RefreshCw,
  ShieldCheck,
  TerminalSquare,
  Wrench,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SelectControl } from "../../components/SelectControl";
import { ConfirmDialog, PageHeader } from "../../components/ui";
import { useTranslate } from "../../lib/i18n";
import { errorMessage } from "../../lib/presentation";
import {
  buildDiagnosticPreviewFiles,
  analyzeDiagnosticSnapshot,
  DEFAULT_DIAGNOSTIC_PREVIEW_SELECTION,
  diagnosticPreviewContainsExcludedContent,
} from "@janusgraph/application";
import type { DiagnosticPreviewSelection } from "@janusgraph/domain";
import { DiagnosticReportPanel } from "./DiagnosticReportPanel";
import { DiagnosticRecordPanel } from "./DiagnosticRecordPanel";

type DiagnosticPreviewSection = keyof DiagnosticPreviewSelection;

type PreviewState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; snapshot: DiagnosticPreviewSnapshot };

const ALL_LEVELS: DiagnosticLogLevel[] = ["debug", "info", "warn", "error"];
const DEFAULT_SOURCES: DiagnosticLogSource[] = [
  "application",
  "renderer",
  "ipc",
  "connection",
  "query",
  "schema",
  "transfer",
  "compatibility",
  "storage",
  "security",
];

function formatTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

export function DiagnosticsPage({ incident }: { incident?: DiagnosticIncidentContext }) {
  const t = useTranslate();
  const [state, setState] = useState<PreviewState>({ status: "loading" });
  const [selection, setSelection] = useState<DiagnosticPreviewSelection>(
    DEFAULT_DIAGNOSTIC_PREVIEW_SELECTION,
  );
  const [logLimit, setLogLimit] = useState(100);
  const [levels, setLevels] = useState<DiagnosticLogLevel[]>(ALL_LEVELS);
  const [sources] = useState<DiagnosticLogSource[]>(DEFAULT_SOURCES);
  const [activeFileId, setActiveFileId] = useState<DiagnosticPreviewSection>("summary");
  const [copied, setCopied] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportResult, setExportResult] = useState<{ tone: "success" | "error"; message: string } | null>(null);
  const [inspection, setInspection] = useState<DiagnosticBundleInspectionResult | null>(null);
  const [records, setRecords] = useState<DiagnosticRecord[]>([]);
  const [selectedRecord, setSelectedRecord] = useState<DiagnosticRecord | null>(null);
  const [removingRecord, setRemovingRecord] = useState<DiagnosticRecord | null>(null);
  const [inspecting, setInspecting] = useState(false);
  const lastSavedFingerprint = useRef("");
  const desktopApiUnavailable = t("桌面诊断接口不可用", "Desktop diagnostics API is unavailable");

  const load = useCallback(async () => {
    setState({ status: "loading" });
    setCopied(false);
    try {
      const api = window.janusGraphDesktop;
      if (!api) throw new Error(desktopApiUnavailable);
      const snapshot = await api.diagnostics.preview({ limit: logLimit, levels, sources, incident });
      setState({ status: "ready", snapshot });
    } catch (error) {
      setState({ status: "error", message: errorMessage(error) });
    }
  }, [desktopApiUnavailable, incident, levels, logLimit, sources]);

  useEffect(() => {
    void load();
  }, [load]);

  const files = useMemo(
    () => state.status === "ready"
      ? buildDiagnosticPreviewFiles(state.snapshot, selection)
      : [],
    [selection, state],
  );
  const activeFile = files.find((file) => file.id === activeFileId) ?? files[0];
  const totalItems = files.reduce((total, file) => total + file.itemCount, 0);
  const exclusionGuardPassed = !diagnosticPreviewContainsExcludedContent(files);
  const liveReport = useMemo(() => state.status === "ready" ? analyzeDiagnosticSnapshot(state.snapshot) : null, [state]);

  const loadRecords = useCallback(async () => {
    const next = await window.janusGraphDesktop?.diagnostics.listRecords(200);
    if (next) setRecords(next);
  }, []);

  useEffect(() => { void loadRecords(); }, [loadRecords]);
  useEffect(() => {
    if (!liveReport || (!incident && liveReport.findings.length === 0) || !window.janusGraphDesktop) return;
    const key = JSON.stringify({ incident, findings: liveReport.findings.map((finding) => finding.code) });
    if (lastSavedFingerprint.current === key) return;
    lastSavedFingerprint.current = key;
    const safeIncident = state.status === "ready" ? state.snapshot.incident : undefined;
    void window.janusGraphDesktop.diagnostics.saveRecord({ origin: "live", incident: safeIncident, report: liveReport })
      .then(() => loadRecords())
      .catch((error) => setExportResult({ tone: "error", message: errorMessage(error) }));
  }, [incident, liveReport, loadRecords, state]);

  useEffect(() => {
    if (files.length > 0 && !files.some((file) => file.id === activeFileId)) {
      setActiveFileId(files[0]!.id);
    }
  }, [activeFileId, files]);

  const toggleSection = (section: DiagnosticPreviewSection) => {
    setSelection((current) => {
      const enabledCount = Object.values(current).filter(Boolean).length;
      if (current[section] && enabledCount === 1) return current;
      return { ...current, [section]: !current[section] };
    });
  };

  const toggleLevel = (level: DiagnosticLogLevel) => {
    setLevels((current) => {
      if (current.includes(level) && current.length === 1) return current;
      return current.includes(level)
        ? current.filter((candidate) => candidate !== level)
        : ALL_LEVELS.filter((candidate) => [...current, level].includes(candidate));
    });
  };

  const copyPreview = async () => {
    if (!activeFile) return;
    await window.janusGraphDesktop?.runtime.writeClipboard(activeFile.content);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  const exportBundle = async () => {
    const api = window.janusGraphDesktop;
    if (!api || state.status !== "ready" || !exclusionGuardPassed) return;
    setExporting(true);
    setExportResult(null);
    try {
      const result = await api.diagnostics.exportBundle({ selection, limit: logLimit, levels, sources, incident });
      if (result.path) {
        setExportResult({
          tone: "success",
          message: `${t("诊断包已保存", "Diagnostic bundle saved")}: ${result.path}`,
        });
      }
    } catch (error) {
      setExportResult({ tone: "error", message: errorMessage(error) });
    } finally {
      setExporting(false);
    }
  };

  const inspectBundle = async () => {
    if (!window.janusGraphDesktop) return;
    setInspecting(true);
    try {
      const result = await window.janusGraphDesktop.diagnostics.inspectBundle();
      if (result) {
        setInspection(result);
        setSelectedRecord(null);
        await window.janusGraphDesktop.diagnostics.saveRecord({ origin: "bundle", sourceName: result.name, report: result.report });
        await loadRecords();
      }
    } catch (error) {
      setExportResult({ tone: "error", message: errorMessage(error) });
    } finally {
      setInspecting(false);
    }
  };

  const setRecordStatus = async (record: DiagnosticRecord, status: DiagnosticRecordStatus) => {
    const updated = await window.janusGraphDesktop?.diagnostics.setRecordStatus(record.id, status);
    if (updated) {
      setSelectedRecord((current) => current?.id === updated.id ? updated : current);
      await loadRecords();
    }
  };
  const removeRecord = async (record: DiagnosticRecord) => {
    await window.janusGraphDesktop?.diagnostics.removeRecord(record.id);
    if (selectedRecord?.id === record.id) setSelectedRecord(null);
    setRemovingRecord(null);
    await loadRecords();
  };

  const sectionCards: Array<{
    id: DiagnosticPreviewSection;
    icon: typeof FileJson2;
    title: string;
    description: string;
    sensitivity: string;
  }> = [
    {
      id: "summary",
      icon: FileJson2,
      title: t("运行环境摘要", "Runtime summary"),
      description: t("应用、Electron、Node、操作系统与架构版本", "App, Electron, Node, OS and architecture versions"),
      sensitivity: t("低敏感", "Low sensitivity"),
    },
    {
      id: "tasks",
      icon: FileText,
      title: t("最近任务状态", "Recent task state"),
      description: t("最多 50 条任务阶段、图名称、进度和脱敏错误", "Up to 50 task stages, graph names, progress and redacted errors"),
      sensitivity: t("中等敏感", "Moderate sensitivity"),
    },
    {
      id: "logs",
      icon: FileCode2,
      title: t("环形诊断日志", "Ring diagnostic logs"),
      description: t("主进程、查询、Schema 与迁移事件；不含查询正文", "Main, query, Schema and transfer events; query text excluded"),
      sensitivity: t("较高敏感", "Elevated sensitivity"),
    },
  ];

  return (
    <div className="page-scroll diagnostics-page">
      <PageHeader
        eyebrow="TROUBLESHOOTING"
        title={t("问题诊断", "Problem diagnostics")}
        description={t(
          "当连接、Schema、动态图或导入导出发生异常时，先根据证据自动分析，再生成可安全分享的脱敏诊断包。",
          "When connections, Schema, dynamic graphs or transfers fail, analyze the evidence first, then create a redacted bundle that can be safely shared.",
        )}
      />

      {incident && (
        <section className="diagnostics-incident" aria-label={t("当前故障上下文", "Current failure context")}>
          <span className="diagnostics-incident-mark"><AlertTriangle size={19} /></span>
          <div>
            <span className="eyebrow">CURRENT INCIDENT</span>
            <strong>{incident.title}</strong>
            <small>
              {[incident.connectionName, incident.graphName, incident.stage].filter(Boolean).join(" · ")}
            </small>
          </div>
          <p>{incident.message || t("已从故障入口带入上下文", "Context was carried from the failure entry")}</p>
        </section>
      )}

      <DiagnosticRecordPanel records={records} selectedId={selectedRecord?.id} onToggle={(record) => { setSelectedRecord((current) => current?.id === record.id ? null : record); setInspection(null); }} onStatus={(record, status) => void setRecordStatus(record, status)} onRemove={setRemovingRecord} />

      {selectedRecord
        ? <DiagnosticReportPanel report={selectedRecord.report} sourceName={selectedRecord.sourceName || selectedRecord.incident?.title} />
        : inspection
          ? <DiagnosticReportPanel report={inspection.report} sourceName={inspection.name} />
          : liveReport && <DiagnosticReportPanel report={liveReport} />}

      <section className="diagnostics-purpose">
        <div className="diagnostics-purpose-mark"><Wrench size={28} /></div>
        <div className="diagnostics-purpose-copy">
          <span className="eyebrow">WHEN SOMETHING GOES WRONG</span>
          <h2>{t("先给出排查方向，再把证据完整打包", "Find a troubleshooting direction before packaging the evidence")}</h2>
          <p>{t(
            "规则引擎会检查应用版本、最近任务阶段和脱敏日志，展示结论、证据与建议。它不会修改连接、图数据或 Schema。",
            "The rule engine checks app versions, recent task stages and redacted logs, then shows findings, evidence and recommendations. It never changes connections, graph data or Schema.",
          )}</p>
          <div className="diagnostics-purpose-steps">
            <span><b>01</b>{t("操作发生异常", "An operation fails")}</span>
            <span><b>02</b>{t("自动匹配证据", "Match evidence automatically")}</span>
            <span><b>03</b>{t("导出报告或继续复核", "Export the report or review further")}</span>
          </div>
        </div>
        <div className="diagnostics-purpose-action">
          <button
            type="button"
            className="button primary diagnostics-generate"
            disabled={state.status !== "ready" || exporting || !exclusionGuardPassed}
            onClick={() => void exportBundle()}
          >
            {exporting ? <LoaderCircle className="spin" size={19} /> : <Archive size={19} />}
            {exporting ? t("正在生成…", "Creating…") : t("生成诊断包", "Create diagnostic bundle")}
          </button>
          <small>{t("生成前会打开系统保存窗口", "A system save dialog opens before writing")}</small>
          <button type="button" className="button secondary" disabled={inspecting} onClick={() => void inspectBundle()}>
            {inspecting ? <LoaderCircle className="spin" size={17} /> : <FolderSearch size={17} />}
            {t("分析已有诊断包", "Analyze existing bundle")}
          </button>
          <button type="button" className="button text" onClick={() => setAdvancedOpen((current) => !current)}>
            {advancedOpen ? t("收起高级选项", "Hide advanced options") : t("查看内容与高级选项", "Review contents and advanced options")}
          </button>
        </div>
      </section>

      {exportResult && (
        <div className={`diagnostics-result is-${exportResult.tone}`} role="status">
          {exportResult.tone === "success" ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />}
          <span>{exportResult.message}</span>
        </div>
      )}

      {!advancedOpen && (
        <section className="diagnostics-compact-safety">
          <ShieldCheck size={18} />
          <strong>{t("固定排除密码、Token、认证 Header、私钥和查询正文", "Passwords, tokens, authentication headers, private keys and query text are always excluded")}</strong>
          <span>{files.length} {t("个脱敏文件已准备", "redacted files ready")}</span>
        </section>
      )}

      {advancedOpen && <>
      <section className="diagnostics-safety-rail" aria-label={t("隐私边界", "Privacy boundary")}>
        <div className="diagnostics-safety-mark"><ShieldCheck size={24} /></div>
        <div>
          <span className="eyebrow">PRIVACY BOUNDARY</span>
          <strong>{t("凭据与查询正文始终排除", "Credentials and query text are always excluded")}</strong>
          <p>{t(
            "密码、Token、认证 Header、私钥、URL 凭据、查询正文和字符串绑定无法在本页开启。",
            "Passwords, tokens, authentication headers, private keys, URL credentials, query text and string bindings cannot be enabled here.",
          )}</p>
        </div>
        <span className={`diagnostics-guard ${exclusionGuardPassed ? "is-safe" : "is-alert"}`}>
          {exclusionGuardPassed ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
          {exclusionGuardPassed ? t("保护已生效", "Guard active") : t("需要复核", "Review required")}
        </span>
      </section>

      <div className="diagnostics-layout">
        <div className="diagnostics-controls">
          <section className="diagnostics-panel diagnostics-contents">
            <header>
              <div><Fingerprint size={19} /><span><strong>{t("选择内容", "Choose contents")}</strong><small>{t("至少保留一个文件", "Keep at least one file")}</small></span></div>
              <span className="diagnostics-count">{files.length} {t("个文件", "files")}</span>
            </header>
            <div className="diagnostics-section-list">
              {sectionCards.map((card) => {
                const Icon = card.icon;
                const checked = selection[card.id];
                return (
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={checked}
                    key={card.id}
                    className={`diagnostics-section-card ${checked ? "is-selected" : ""}`}
                    onClick={() => toggleSection(card.id)}
                  >
                    <span className="diagnostics-section-icon"><Icon size={20} /></span>
                    <span><strong>{card.title}</strong><small>{card.description}</small><em>{card.sensitivity}</em></span>
                    <span className="diagnostics-check">{checked && <Check size={15} />}</span>
                  </button>
                );
              })}
            </div>
          </section>

          <section className="diagnostics-panel diagnostics-log-scope">
            <header>
              <div><TerminalSquare size={19} /><span><strong>{t("日志范围", "Log scope")}</strong><small>{t("仅影响 logs.ndjson", "Only affects logs.ndjson")}</small></span></div>
            </header>
            <label className="field">
              <span>{t("最近日志条数", "Recent log entries")}</span>
              <SelectControl
                ariaLabel={t("最近日志条数", "Recent log entries")}
                value={String(logLimit)}
                disabled={!selection.logs}
                onValueChange={(value) => setLogLimit(Number(value))}
                options={[50, 100, 200, 500].map((value) => ({ value: String(value), label: `${value}` }))}
              />
            </label>
            <div className="diagnostics-levels" aria-label={t("日志级别", "Log levels")}>
              {ALL_LEVELS.map((level) => (
                <button
                  type="button"
                  key={level}
                  className={levels.includes(level) ? "is-active" : ""}
                  disabled={!selection.logs}
                  onClick={() => toggleLevel(level)}
                >
                  <span />{level.toUpperCase()}
                </button>
              ))}
            </div>
          </section>

          <section className="diagnostics-excluded">
            <LockKeyhole size={18} />
            <div><strong>{t("固定排除项", "Always excluded")}</strong><span>{t("凭据 · 认证 Header · 私钥 · 查询正文 · 字符串绑定", "Credentials · auth headers · private keys · query text · string bindings")}</span></div>
          </section>
        </div>

        <section className="diagnostics-preview diagnostics-panel">
          <header>
            <div>
              <span className="eyebrow">REDACTED PREVIEW</span>
              <strong>{state.status === "ready" ? formatTime(state.snapshot.generatedAt) : t("正在生成快照", "Preparing snapshot")}</strong>
            </div>
            <div className="diagnostics-preview-meta">
              <span>{totalItems} {t("项", "items")}</span>
              <button type="button" className="button secondary" disabled={!activeFile || state.status !== "ready"} onClick={() => void copyPreview()}>
                {copied ? <Check size={16} /> : <Clipboard size={16} />}
                {copied ? t("已复制", "Copied") : t("复制当前文件", "Copy current file")}
              </button>
            </div>
          </header>

          {state.status === "loading" && (
            <div className="diagnostics-preview-state"><LoaderCircle className="spin" size={26} /><span>{t("正在读取只读诊断快照…", "Reading the read-only diagnostic snapshot…")}</span></div>
          )}
          {state.status === "error" && (
            <div className="diagnostics-preview-state is-error"><AlertTriangle size={25} /><strong>{t("无法读取诊断快照", "Unable to read diagnostic snapshot")}</strong><span>{state.message}</span></div>
          )}
          {state.status === "ready" && (
            <>
              <div className="diagnostics-file-tabs" role="tablist" aria-label={t("诊断文件", "Diagnostic files")}>
                {files.map((file) => (
                  <button
                    type="button"
                    role="tab"
                    aria-selected={activeFile?.id === file.id}
                    key={file.id}
                    className={activeFile?.id === file.id ? "is-active" : ""}
                    onClick={() => setActiveFileId(file.id)}
                  >
                    <span>{file.name}</span>
                    <small>{file.itemCount}</small>
                  </button>
                ))}
              </div>
              {activeFile && (
                <div className="diagnostics-code-frame">
                  <div><span>{activeFile.name}</span><span className={`is-${activeFile.sensitivity}`}>{sectionCards.find((card) => card.id === activeFile.id)?.sensitivity}</span></div>
                  <pre tabIndex={0}>{activeFile.content || t("当前范围内没有记录", "No records in the current scope")}</pre>
                </div>
              )}
            </>
          )}
        </section>
      </div>
      </>}
      {removingRecord && <ConfirmDialog
        title={t("删除诊断记录", "Delete diagnostic record")}
        description={t("该记录及其自动诊断结论将从本机永久删除，已导出的 ZIP 不受影响。", "This local record and its findings will be permanently deleted. Exported ZIP files are not affected.")}
        confirmLabel={t("删除记录", "Delete record")}
        onCancel={() => setRemovingRecord(null)}
        onConfirm={() => void removeRecord(removingRecord)}
      />}
    </div>
  );
}
