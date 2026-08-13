import type { ConnectionSummary } from "@janusgraph/domain";
import {
  AlertTriangle,
  CheckCircle2,
  CircleDashed,
  CirclePlus,
  ClipboardCopy,
  Database,
  FileJson,
  Flame,
  LoaderCircle,
  Minimize2,
  RefreshCw,
  Search,
  ShieldCheck,
  Upload,
  Wrench,
  XCircle,
} from "lucide-react";
import { useDeferredValue, useEffect, useMemo, useRef, useState, type UIEvent } from "react";
import { Modal } from "../../components/ui";
import type { DynamicGraphContext } from "../../lib/dynamic-graph-context";
import { useTranslate } from "../../lib/i18n";
import {
  createSchemaConversionPreview,
  formatSchemaArchiveTime,
  type SchemaArchive,
  type SchemaImportPlan,
  type SchemaImportReviewKind,
} from "../../lib/schema-files";

type ImportView = "summary" | "changes" | "conversion" | "batches";
type ReviewFilter = "all" | SchemaImportReviewKind;

const reviewKinds: SchemaImportReviewKind[] = ["create", "skip", "conflict", "manual", "dangerous"];
const conversionPreviewLineHeight = 19;
const conversionPreviewOverscan = 36;
const conversionPreviewWindowSize = 120;

function createConversionDocument(value: unknown) {
  const text = JSON.stringify(value, null, 2);
  const lines = text.split("\n");
  const longestLine = lines.reduce((longest, line) => Math.max(longest, line.length), 0);
  return {
    text,
    lines,
    width: Math.min(Math.max(longestLine + 4, 80), 4_000),
  };
}

function SchemaConversionPreview({
  lines,
  width,
  busy,
  label,
}: {
  lines: string[];
  width: number;
  busy: boolean;
  label: string;
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<number | null>(null);
  const [startLine, setStartLine] = useState(0);

  useEffect(() => {
    setStartLine(0);
    if (viewportRef.current) viewportRef.current.scrollTop = 0;
  }, [lines]);

  useEffect(() => () => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
  }, []);

  const handleScroll = (event: UIEvent<HTMLDivElement>) => {
    const scrollTop = event.currentTarget.scrollTop;
    if (frameRef.current !== null) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      const nextStart = Math.max(
        0,
        Math.floor(scrollTop / conversionPreviewLineHeight) - conversionPreviewOverscan,
      );
      setStartLine((current) => current === nextStart ? current : nextStart);
    });
  };
  const endLine = Math.min(lines.length, startLine + conversionPreviewWindowSize);

  return (
    <div
      ref={viewportRef}
      className="schema-conversion-preview"
      role="textbox"
      tabIndex={0}
      aria-readonly="true"
      aria-busy={busy}
      aria-label={label}
      onScroll={handleScroll}
    >
      <div
        className="schema-conversion-preview-canvas"
        style={{
          height: `${lines.length * conversionPreviewLineHeight}px`,
          minWidth: `${width}ch`,
        }}
      >
        {lines.slice(startLine, endLine).map((line, offset) => (
          <div
            className="schema-conversion-preview-line"
            key={startLine + offset}
            style={{ top: `${(startLine + offset) * conversionPreviewLineHeight}px` }}
          >
            {line || "\u00a0"}
          </div>
        ))}
      </div>
    </div>
  );
}

export function SchemaImportDialog({
  activeConnection,
  graphContext,
  value,
  busy,
  cancelRequested,
  failureMessage,
  progress,
  onClose,
  onBackground,
  onCancel,
  onRegenerate,
  onApply,
}: {
  activeConnection: ConnectionSummary | undefined;
  graphContext: DynamicGraphContext | null;
  value: { fileName: string; archive: SchemaArchive; plan: SchemaImportPlan };
  busy: boolean;
  cancelRequested: boolean;
  failureMessage: string | null;
  progress: { current: number; total: number; message: string } | null;
  onClose: () => void;
  onBackground: () => void;
  onCancel: () => void;
  onRegenerate: () => void;
  onApply: () => void;
}) {
  const t = useTranslate();
  const [view, setView] = useState<ImportView>("summary");
  const [search, setSearch] = useState("");
  const [batchIndex, setBatchIndex] = useState(0);
  const [reviewFilter, setReviewFilter] = useState<ReviewFilter>("all");
  const [conversionFormat, setConversionFormat] = useState<"official" | "studio">("official");
  const conversion = useMemo(() => createSchemaConversionPreview(value.archive), [value.archive]);
  const conversionDocuments = useMemo(() => ({
    official: createConversionDocument(conversion.official),
    studio: createConversionDocument(conversion.studio),
  }), [conversion]);
  const deferredConversionFormat = useDeferredValue(conversionFormat);
  const reviewCounts = useMemo(() => Object.fromEntries(reviewKinds.map((kind) => [
    kind,
    value.plan.review.filter((item) => item.kind === kind).length,
  ])) as Record<SchemaImportReviewKind, number>, [value.plan.review]);
  const normalizedSearch = search.trim().toLocaleLowerCase();
  const visibleChanges = value.plan.review.filter((item) =>
    (reviewFilter === "all" || item.kind === reviewFilter) &&
    (!normalizedSearch || `${item.label} ${item.detail} ${item.key}`.toLocaleLowerCase().includes(normalizedSearch)),
  );
  const conversionText = conversionDocuments[conversionFormat].text;
  const visibleConversionDocument = conversionDocuments[deferredConversionFormat];
  const reviewLabel = (kind: ReviewFilter) => ({
    all: t("全部", "All"),
    create: t("创建", "Create"),
    skip: t("跳过", "Skip"),
    conflict: t("冲突", "Conflict"),
    manual: t("人工审阅", "Manual review"),
    dangerous: t("高影响", "High impact"),
  })[kind];
  const reviewIcon = (kind: SchemaImportReviewKind) => kind === "create"
    ? <CirclePlus size={15} />
    : kind === "skip"
      ? <CircleDashed size={15} />
      : kind === "conflict"
        ? <XCircle size={15} />
        : kind === "manual"
          ? <Wrench size={15} />
          : <Flame size={15} />;
  const targetName = activeConnection
    ? graphContext
      ? `${activeConnection.name} / ${graphContext.name}`
      : activeConnection.name
    : t("未选择连接", "No connection selected");
  const targetGraphName = graphContext?.name ?? activeConnection?.graphBinding ?? "";

  return (
    <Modal
      eyebrow="SCHEMA IMPORT PLAN"
      title={t("审阅 Schema 导入计划", "Review Schema Import Plan")}
      onClose={() => { if (busy) onBackground(); else onClose(); }}
      width="xwide"
    >
      <div className="schema-import-workspace">
        <nav className="schema-import-view-tabs" aria-label={t("Schema 导入视图", "Schema import views")}>
          <button type="button" className={view === "summary" ? "is-active" : ""} onClick={() => setView("summary")}>
            <Database size={16} />
            <span>{t("导入概览", "Overview")}</span>
          </button>
          <button type="button" className={view === "changes" ? "is-active" : ""} onClick={() => setView("changes")}>
            <CheckCircle2 size={16} />
            <span>{t("五类影响审阅", "Impact review")}</span>
            <strong>{value.plan.review.length}</strong>
          </button>
          <button type="button" className={view === "conversion" ? "is-active" : ""} onClick={() => setView("conversion")}>
            <RefreshCw size={16} />
            <span>{t("归档转换预览", "Conversion preview")}</span>
          </button>
          <button
            type="button"
            className={view === "batches" ? "is-active" : ""}
            disabled={value.plan.scripts.length === 0}
            onClick={() => setView("batches")}
          >
            <FileJson size={16} />
            <span>{value.plan.execution === "official-json"
              ? t("官方导入批次", "Native import batches")
              : t("Gremlin 批次", "Gremlin batches")}</span>
            <strong>{value.plan.scripts.length}</strong>
          </button>
        </nav>

        <main className={`schema-import-pane is-${view}`}>
          {view === "summary" && (
            <div className="schema-import-summary-scroll">
              <div className="schema-import-source">
                <FileJson size={22} />
                <div>
                  <strong>{value.fileName}</strong>
                  <small>
                    {t("来源", "Source")}: {value.archive.source.connectionName}
                    {value.archive.exportedAt ? ` · ${formatSchemaArchiveTime(value.archive.exportedAt)}` : ""}
                  </small>
                </div>
                <span className={value.plan.execution === "official-json" ? "is-official" : undefined}>
                  {value.plan.execution === "official-json" ? "JsonSchemaInitStrategy" : value.archive.format}
                </span>
              </div>
              <div className={`schema-import-target ${activeConnection?.environment === "prod" ? "is-production" : ""}`}>
                {activeConnection?.environment === "prod" ? <AlertTriangle size={18} /> : <Database size={18} />}
                <div><span>{t("目标图连接", "Target graph connection")}</span><strong>{targetName}</strong></div>
                {activeConnection?.environment === "prod" && <small>{t(
                  "这是生产连接。确认导入即表示允许执行已审阅的 Schema 写入计划。",
                  "This is a production connection. Confirming authorizes the reviewed Schema write plan.",
                )}</small>}
              </div>
              <div className="schema-import-stats">
                <article className="is-create"><strong>{reviewCounts.create}</strong><span>{reviewLabel("create")}</span></article>
                <article className="is-skip"><strong>{reviewCounts.skip}</strong><span>{reviewLabel("skip")}</span></article>
                <article className="is-conflict"><strong>{reviewCounts.conflict}</strong><span>{reviewLabel("conflict")}</span></article>
                <article className="is-manual"><strong>{reviewCounts.manual}</strong><span>{reviewLabel("manual")}</span></article>
                <article className="is-dangerous"><strong>{reviewCounts.dangerous}</strong><span>{reviewLabel("dangerous")}</span></article>
              </div>
              <div className={`schema-import-route is-${value.plan.execution}`}>
                <FileJson size={18} />
                <div>
                  <strong>{value.plan.execution === "official-json"
                    ? t("JanusGraph 1.1 官方导入路径", "JanusGraph 1.1 native import path")
                    : value.archive.format === "janusgraph.schema/json"
                      ? t("Management API 无损兼容路径", "Lossless Management API compatibility path")
                      : t("Janus Studio 增量导入路径", "Janus Studio additive import path")}</strong>
                  <small>{value.plan.execution === "official-json"
                    ? t("文件按官方 JsonSchemaInitStrategy 分批执行；官方专属字段保持原值，不会转换或丢弃。", "The file runs in batches through JsonSchemaInitStrategy; official-only fields remain unchanged.")
                    : value.archive.format === "janusgraph.schema/json"
                      ? t("当前文件可无损转换为通用 Management 操作，适用于未提供官方 JSON API 的服务端。", "This file can be converted losslessly to Management operations when the native JSON API is unavailable.")
                      : t("仅创建缺少的定义，并在每个批次后回读校验。", "Only missing definitions are created and verified after every batch.")}</small>
                </div>
              </div>
              <div className="schema-import-notice">
                <ShieldCheck size={18} />
                <div><strong>{t("安全的增量导入", "Safe additive import")}</strong><small>{t(
                  `只创建目标图中缺少的定义；不会删除或覆盖已有 Schema。${value.plan.scripts.length} 个批次会按依赖顺序执行并回读校验。`,
                  `Only missing definitions are created. ${value.plan.scripts.length} dependency-ordered batches are verified after execution.`,
                )}</small></div>
              </div>
              {value.plan.indexActivations.length > 0 && (
                <div className="schema-import-index-note">
                  <AlertTriangle size={18} />
                  <div><strong>{t("索引将自动完成生命周期", "Index lifecycle is automated")}</strong><small>{t(
                    "定义创建后会等待索引进入 REGISTERED，再执行 REINDEX，并等待所有字段达到 ENABLED。",
                    "After creation, the import waits for REGISTERED, runs REINDEX, and then waits for every field to reach ENABLED.",
                  )}</small></div>
                </div>
              )}
              {value.plan.manual.length > 0 && (
                <section className="schema-import-manual" aria-label={t("官方保留项", "Official-only items")}>
                  <header><AlertTriangle size={17} /><strong>{t("需审阅的官方专属配置", "Official-only configuration to review")}</strong></header>
                  <p>{t(
                    "这些字段无法用 Janus Studio 通用模型完整比较，将保持原始 JSON 并交给 JanusGraph 官方导入器处理。",
                    "These fields cannot be fully compared by the Janus Studio common model. Their original JSON is preserved for the native JanusGraph importer.",
                  )}</p>
                  <div>
                    {value.plan.manual.map((item) => <article key={`${item.path}:${item.summary}`}><code>{item.path}</code><span>{item.summary}</span></article>)}
                  </div>
                </section>
              )}
              {value.plan.conflicts.length > 0 && (
                <section className="schema-import-conflicts" role="alert">
                  <header><AlertTriangle size={17} /><strong>{t("必须先解决冲突", "Resolve conflicts before importing")}</strong></header>
                  {value.plan.conflicts.map((conflict) => <div key={`${conflict.key}:${conflict.reason}`}><code>{conflict.key}</code><span>{conflict.reason}</span></div>)}
                </section>
              )}
            </div>
          )}

          {view === "changes" && (
            <section className="schema-import-change-browser">
              <header>
                <div>
                  <span className="eyebrow">REVIEW MATRIX</span>
                  <strong>{t("导入影响审阅", "Import impact review")}</strong>
                  <small>{t(
                    "按创建、跳过、冲突、人工审阅与高影响分类检查导入计划。",
                    "Review the import plan by create, skip, conflict, manual review, and high impact.",
                  )}</small>
                </div>
                <label><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t("搜索名称或类型", "Search name or type")} /></label>
                <output>{visibleChanges.length} / {value.plan.review.length}</output>
              </header>
              <div className="schema-import-review-filters">
                {(["all", ...reviewKinds] as ReviewFilter[]).map((kind) => (
                  <button type="button" key={kind} className={`is-${kind} ${reviewFilter === kind ? "is-active" : ""}`} onClick={() => setReviewFilter(kind)}>
                    {kind !== "all" && reviewIcon(kind)}
                    <span>{reviewLabel(kind)}</span>
                    <strong>{kind === "all" ? value.plan.review.length : reviewCounts[kind]}</strong>
                  </button>
                ))}
              </div>
              {visibleChanges.length > 0 ? (
                <div className="schema-import-change-list">
                  {visibleChanges.map((item, index) => (
                    <article key={`${item.kind}:${item.key}`} className={`is-${item.kind}`}>
                      <span>{String(index + 1).padStart(4, "0")}</span>
                      {reviewIcon(item.kind)}
                      <strong>{item.label}</strong>
                      <code>{item.detail === "UNCHANGED"
                        ? t("目标定义相同，不执行写入", "Target definition matches; no write")
                        : item.detail === "REGISTER → WAIT → REINDEX → ENABLED"
                          ? t("REGISTER → WAIT → REINDEX → ENABLED；可能长时间占用后端资源", "REGISTER → WAIT → REINDEX → ENABLED; may consume backend resources for a long time")
                          : item.detail}</code>
                    </article>
                  ))}
                </div>
              ) : <p className="schema-import-browser-empty">{t("没有匹配的变更。", "No matching changes.")}</p>}
            </section>
          )}

          {view === "conversion" && (
            <section className="schema-conversion-browser">
              <header>
                <div>
                  <span className="eyebrow">LOSSLESS FORMAT VIEW</span>
                  <strong>{t("Schema 格式转换预览", "Schema format conversion preview")}</strong>
                  <small>{conversion.preservedOfficialSource
                    ? t("官方 JSON 原文已完整保留；Studio 归档在其外层增加来源与迁移元数据。", "The native JSON source is preserved intact; the Studio archive adds source and migration metadata around it.")
                    : t("此 Studio 归档可由通用模型生成等价的官方 JSON。", "This Studio archive can generate equivalent native JSON from its portable model.")}</small>
                </div>
                <div className="schema-conversion-switch" role="group" aria-label={t("预览格式", "Preview format")}>
                  <button type="button" className={conversionFormat === "official" ? "is-active" : ""} onClick={() => setConversionFormat("official")}>
                    <FileJson size={15} />{t("官方 JSON", "Native JSON")}
                  </button>
                  <button type="button" className={conversionFormat === "studio" ? "is-active" : ""} onClick={() => setConversionFormat("studio")}>
                    <Database size={15} />{t("Studio 归档", "Studio archive")}
                  </button>
                </div>
                <button type="button" className="button secondary" onClick={() => void window.janusGraphDesktop?.runtime.writeClipboard(conversionText)}>
                  <ClipboardCopy size={15} />{t("复制预览", "Copy preview")}
                </button>
              </header>
              <SchemaConversionPreview
                lines={visibleConversionDocument.lines}
                width={visibleConversionDocument.width}
                busy={deferredConversionFormat !== conversionFormat}
                label={t("Schema 格式转换预览", "Schema format conversion preview")}
              />
            </section>
          )}

          {view === "batches" && (
            <section className="schema-import-batch-browser">
              <header>
                <div><span className="eyebrow">{value.plan.execution === "official-json" ? "JSONSCHEMAINITSTRATEGY" : "GREMLIN PLAN"}</span><strong>{t(`批次 ${batchIndex + 1}`, `Batch ${batchIndex + 1}`)}</strong></div>
                <small>{batchIndex + 1} / {value.plan.scripts.length}</small>
              </header>
              <div className="schema-import-batch-list">
                <nav aria-label={value.plan.execution === "official-json" ? t("官方导入批次", "Native import batches") : t("Gremlin 批次", "Gremlin batches")}>
                  {value.plan.scripts.map((_script, index) => (
                    <button type="button" key={`schema-import-batch-${index + 1}`} className={batchIndex === index ? "is-active" : ""} aria-current={batchIndex === index ? "true" : undefined} onClick={() => setBatchIndex(index)}>
                      <span>{String(index + 1).padStart(2, "0")}</span>{t(`批次 ${index + 1}`, `Batch ${index + 1}`)}
                    </button>
                  ))}
                </nav>
                <pre>{value.plan.scripts[batchIndex] ?? ""}</pre>
              </div>
            </section>
          )}
        </main>

        {busy && (
          <section className="schema-import-live-progress" role="status" aria-live="polite">
            <LoaderCircle className="spin" size={19} />
            <div>
              <header>
                <strong>{cancelRequested
                  ? t("正在停止 Schema 导入", "Stopping Schema import")
                  : value.plan.execution === "official-json"
                    ? t("JsonSchemaInitStrategy 正在导入", "Importing with JsonSchemaInitStrategy")
                    : t("正在导入 Schema", "Importing Schema")}</strong>
                <span>{progress ? `${progress.current} / ${progress.total}` : t("准备批次…", "Preparing batches…")}</span>
              </header>
              <progress value={progress?.current ?? 0} max={progress?.total ?? 1} />
              <small>{progress
                ? t(`正在执行第 ${progress.current} 个批次，共 ${progress.total} 个`, `Running batch ${progress.current} of ${progress.total}`)
                : t("正在创建导入任务并连接目标图…", "Creating the import job and connecting to the target graph…")}</small>
            </div>
          </section>
        )}

        {!busy && failureMessage && (
          <section className="schema-import-failure" role="alert">
            <AlertTriangle size={19} />
            <div>
              <strong>{t("Schema 导入未完成", "Schema import did not complete")}</strong>
              <small>{failureMessage}</small>
            </div>
          </section>
        )}

        <footer className="schema-import-actions">
          <button type="button" className="button secondary" disabled={cancelRequested} onClick={busy ? onCancel : onClose}>
            {cancelRequested && <LoaderCircle className="spin" size={17} />}
            {busy ? cancelRequested ? t("正在停止…", "Stopping…") : t("停止导入", "Stop import") : t("取消", "Cancel")}
          </button>
          {busy && (
            <button type="button" className="button secondary" onClick={onBackground}>
              <Minimize2 size={17} />
              {t("后台运行", "Run in background")}
            </button>
          )}
          <button
            type="button"
            className="button primary"
            disabled={busy || (!failureMessage && (value.plan.conflicts.length > 0 || !value.plan.script || !targetGraphName))}
            onClick={failureMessage ? onRegenerate : onApply}
          >
            {busy ? <LoaderCircle className="spin" size={17} /> : failureMessage ? <RefreshCw size={17} /> : <Upload size={17} />}
            {busy
              ? t("正在导入", "Importing")
              : failureMessage
                ? t("重新选择并生成计划", "Select again and regenerate plan")
                : t("导入", "Import")}
          </button>
        </footer>
      </div>
    </Modal>
  );
}
