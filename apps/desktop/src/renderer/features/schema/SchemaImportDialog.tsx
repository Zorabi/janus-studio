import type { ConnectionSummary } from "@janusgraph/domain";
import {
  AlertTriangle,
  CheckCircle2,
  Database,
  FileJson,
  LoaderCircle,
  Minimize2,
  RefreshCw,
  Search,
  ShieldCheck,
  Upload,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Modal } from "../../components/ui";
import type { DynamicGraphContext } from "../../lib/dynamic-graph-context";
import { useTranslate } from "../../lib/i18n";
import {
  formatSchemaArchiveTime,
  type SchemaArchive,
  type SchemaImportPlan,
} from "../../lib/schema-files";

type ImportView = "summary" | "changes" | "batches";

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
  const changes = useMemo(() => [
    ...value.plan.operations.map((item) => ({
      key: `${item.group}:${item.name}`,
      label: item.summary,
      meta: item.group,
      activation: false,
    })),
    ...value.plan.indexActivations.map((name) => ({
      key: `activate:${name}`,
      label: t(`启用 Graph Index · ${name}`, `Enable Graph Index · ${name}`),
      meta: "REGISTER → WAIT → REINDEX → ENABLED",
      activation: true,
    })),
  ], [t, value.plan.indexActivations, value.plan.operations]);
  const normalizedSearch = search.trim().toLocaleLowerCase();
  const visibleChanges = normalizedSearch
    ? changes.filter((item) => `${item.label} ${item.meta}`.toLocaleLowerCase().includes(normalizedSearch))
    : changes;
  const targetName = activeConnection
    ? graphContext
      ? `${activeConnection.name} / ${graphContext.name}`
      : activeConnection.name
    : t("未选择连接", "No connection selected");

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
            <span>{t("变更清单", "Change set")}</span>
            <strong>{changes.length}</strong>
          </button>
          <button
            type="button"
            className={view === "batches" ? "is-active" : ""}
            disabled={value.plan.scripts.length === 0}
            onClick={() => setView("batches")}
          >
            <FileJson size={16} />
            <span>{t("Gremlin 批次", "Gremlin batches")}</span>
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
                  <small>{t("来源", "Source")}: {value.archive.source.connectionName} · {formatSchemaArchiveTime(value.archive.exportedAt)}</small>
                </div>
                <span>{value.archive.format}</span>
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
                <article className="is-create"><strong>{value.plan.operations.length}</strong><span>{t("待创建", "To create")}</span></article>
                <article className="is-skip"><strong>{value.plan.skipped.length}</strong><span>{t("相同并跳过", "Matching and skipped")}</span></article>
                <article className="is-activate"><strong>{value.plan.indexActivations.length}</strong><span>{t("待启用索引", "Indexes to enable")}</span></article>
                <article className="is-conflict"><strong>{value.plan.conflicts.length}</strong><span>{t("冲突", "Conflicts")}</span></article>
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
                <div><span className="eyebrow">CHANGE SET</span><strong>{t("即将应用的变更", "Planned changes")}</strong></div>
                <label><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t("搜索名称或类型", "Search name or type")} /></label>
                <output>{visibleChanges.length} / {changes.length}</output>
              </header>
              {visibleChanges.length > 0 ? (
                <div className="schema-import-change-list">
                  {visibleChanges.map((item, index) => (
                    <article key={item.key}>
                      <span>{String(index + 1).padStart(4, "0")}</span>
                      {item.activation ? <RefreshCw size={15} /> : <CheckCircle2 size={15} />}
                      <strong>{item.label}</strong>
                      <code>{item.meta}</code>
                    </article>
                  ))}
                </div>
              ) : <p className="schema-import-browser-empty">{t("没有匹配的变更。", "No matching changes.")}</p>}
            </section>
          )}

          {view === "batches" && (
            <section className="schema-import-batch-browser">
              <header>
                <div><span className="eyebrow">GREMLIN PLAN</span><strong>{t(`批次 ${batchIndex + 1}`, `Batch ${batchIndex + 1}`)}</strong></div>
                <small>{batchIndex + 1} / {value.plan.scripts.length}</small>
              </header>
              <div className="schema-import-batch-list">
                <nav aria-label={t("Gremlin 批次", "Gremlin batches")}>
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
            disabled={busy || (!failureMessage && (value.plan.conflicts.length > 0 || !value.plan.script))}
            onClick={failureMessage ? onRegenerate : onApply}
          >
            {busy ? <LoaderCircle className="spin" size={17} /> : failureMessage ? <RefreshCw size={17} /> : <Upload size={17} />}
            {busy
              ? t("正在导入", "Importing")
              : failureMessage
                ? t("重新选择并生成计划", "Select again and regenerate plan")
                : t("确认并导入", "Confirm and Import")}
          </button>
        </footer>
      </div>
    </Modal>
  );
}
