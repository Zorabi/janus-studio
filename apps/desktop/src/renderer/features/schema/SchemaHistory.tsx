import type { DiagnosticIncidentContext, SchemaJob, SchemaJobStatus } from "@janusgraph/domain";
import {
  AlertTriangle,
  Check,
  Clock3,
  Copy,
  History,
  RotateCcw,
  Search,
  Stethoscope,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { SelectControl } from "../../components/SelectControl";
import { EmptyState, IconButton, Modal } from "../../components/ui";
import { useLocale, useTranslate } from "../../lib/i18n";
import { formatDate } from "../../lib/presentation";

type StatusFilter = "all" | SchemaJobStatus;
type MessageTooltip = { message: string; left: number; top: number; width: number };

export function SchemaHistory({
  jobs,
  busy,
  onRetry,
  onDismiss,
  onOpenDiagnostics,
}: {
  jobs: SchemaJob[];
  busy: boolean;
  onRetry: (job: SchemaJob) => void;
  onDismiss: (job: SchemaJob) => void;
  onOpenDiagnostics: (incident: DiagnosticIncidentContext) => void;
}) {
  const t = useTranslate();
  const locale = useLocale();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [detailJob, setDetailJob] = useState<SchemaJob | null>(null);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const [messageTooltip, setMessageTooltip] = useState<MessageTooltip | null>(null);
  const showMessageTooltip = (element: HTMLElement, message: string) => {
    const bounds = element.getBoundingClientRect();
    const width = Math.min(420, window.innerWidth - 24);
    const sideLeft = bounds.right + 10;
    const left = sideLeft + width <= window.innerWidth - 12
      ? sideLeft
      : Math.max(12, Math.min(bounds.left, window.innerWidth - width - 12));
    setMessageTooltip({
      message,
      left,
      top: Math.max(12, Math.min(bounds.top, window.innerHeight - 118)),
      width,
    });
  };
  useEffect(() => {
    if (!messageTooltip) return;
    const dismiss = () => setMessageTooltip(null);
    window.addEventListener("resize", dismiss);
    window.addEventListener("scroll", dismiss, true);
    return () => {
      window.removeEventListener("resize", dismiss);
      window.removeEventListener("scroll", dismiss, true);
    };
  }, [messageTooltip]);
  const normalizedSearch = search.trim().toLocaleLowerCase();
  const filtered = useMemo(
    () =>
      jobs.filter(
        (job) =>
          (status === "all" || job.status === status) &&
          (!normalizedSearch ||
            [
              job.indexName,
              job.action,
              job.connectionName,
              job.message,
            ]
              .join(" ")
              .toLocaleLowerCase()
              .includes(normalizedSearch)),
      ),
    [jobs, normalizedSearch, status],
  );
  const statusLabel = (value: SchemaJobStatus) => {
    if (value === "succeeded") return t("成功", "Succeeded");
    if (value === "failed") return t("失败", "Failed");
    if (value === "interrupted") return t("已中断", "Interrupted");
    return t("执行中", "Running");
  };

  return (
    <>
    <section className="schema-history-page" aria-label={t("Schema 操作历史", "Schema operation history")}>
      <div className="schema-history-summary">
        <div>
          <History size={20} />
          <span>
            <strong>{jobs.length}</strong>
            <small>{t("全部操作", "All operations")}</small>
          </span>
        </div>
        <div>
          <Clock3 size={20} />
          <span>
            <strong>{jobs.filter((job) => job.status === "failed" || job.status === "interrupted").length}</strong>
            <small>{t("需要处理", "Needs attention")}</small>
          </span>
        </div>
      </div>

      <div className="schema-history-toolbar">
        <Search size={18} />
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={t("搜索索引、连接或操作", "Search index, connection or action")}
          aria-label={t("搜索 Schema 操作历史", "Search Schema operation history")}
        />
        <SelectControl
          className="schema-history-status"
          ariaLabel={t("状态筛选", "Status filter")}
          value={status}
          onValueChange={(value) => setStatus(value as StatusFilter)}
          options={[
            { value: "all", label: t("全部状态", "All statuses") },
            { value: "succeeded", label: t("成功", "Succeeded") },
            { value: "failed", label: t("失败", "Failed") },
            { value: "interrupted", label: t("已中断", "Interrupted") },
            { value: "running", label: t("执行中", "Running") },
          ]}
        />
        <span>{filtered.length} {t("条", "records")}</span>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={<History size={31} />}
          title={
            jobs.length
              ? t("没有匹配的操作记录", "No matching operations")
              : t("还没有 Schema 操作记录", "No Schema operations yet")
          }
          description={
            jobs.length
              ? t("尝试修改搜索内容或状态筛选。", "Try another search or status filter.")
              : t(
                  "索引生命周期操作完成后会记录在这里。",
                  "Index lifecycle operations appear here after they run.",
                )
          }
        />
      ) : (
        <div className="history-table-wrap schema-history-table-wrap">
          <table className="history-table schema-history-table">
            <thead>
              <tr>
                <th>{t("状态", "Status")}</th>
                <th>{t("索引", "Index")}</th>
                <th>{t("操作", "Action")}</th>
                <th>{t("连接", "Connection")}</th>
                <th>{t("耗时", "Duration")}</th>
                <th>{t("时间", "Time")}</th>
                <th>{t("处理", "Controls")}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((job) => (
                <tr key={job.id}>
                  <td>
                    <span className={`schema-job-badge ${job.status}`}>
                      {statusLabel(job.status)}
                    </span>
                  </td>
                  <td>
                    <strong>{job.indexName}</strong>
                    {job.message && (
                      <button
                        type="button"
                        className={`schema-job-message ${job.status === "failed" || job.status === "interrupted" ? "is-error" : ""}`}
                        onClick={() => { setMessageTooltip(null); setDetailJob(job); setCopyState("idle"); }}
                        onMouseEnter={(event) => showMessageTooltip(event.currentTarget, job.message)}
                        onMouseLeave={() => setMessageTooltip(null)}
                        onFocus={(event) => showMessageTooltip(event.currentTarget, job.message)}
                        onBlur={() => setMessageTooltip(null)}
                        aria-label={t("查看完整异常信息", "View full operation details")}
                      >
                        <span>{job.message}</span>
                      </button>
                    )}
                  </td>
                  <td><code>{job.action}</code></td>
                  <td>{job.connectionName}</td>
                  <td>{job.durationMs > 0 ? `${job.durationMs} ms` : "—"}</td>
                  <td>{formatDate(job.updatedAt, locale)}</td>
                  <td>
                    <div className="row-actions">
                      {(job.status === "failed" || job.status === "interrupted") && (
                        <button
                          type="button"
                          className="button text"
                          disabled={busy}
                          onClick={() => onRetry(job)}
                        >
                          <RotateCcw size={15} />
                          {job.action === "IMPORT_SCHEMA"
                            ? t("重新生成计划", "Regenerate plan")
                            : t("重试", "Retry")}
                        </button>
                      )}
                      <IconButton
                        label={t("删除此记录", "Delete this record")}
                        tone="danger"
                        disabled={busy || job.status === "running"}
                        onClick={() => onDismiss(job)}
                      >
                        <Trash2 size={15} />
                      </IconButton>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
    {detailJob && (
      <Modal
        eyebrow="SCHEMA OPERATION DETAILS"
        title={detailJob.status === "failed" || detailJob.status === "interrupted"
          ? t("Schema 异常详情", "Schema Error Details")
          : t("Schema 操作详情", "Schema Operation Details")}
        onClose={() => setDetailJob(null)}
        width="wide"
      >
        <div className="schema-job-detail">
          <header className={detailJob.status === "failed" || detailJob.status === "interrupted" ? "is-error" : ""}>
            <AlertTriangle size={20} />
            <div>
              <strong>{detailJob.indexName}</strong>
              <small>{detailJob.connectionName} · {detailJob.action} · {formatDate(detailJob.updatedAt, locale)}</small>
            </div>
            <span className={`schema-job-badge ${detailJob.status}`}>{statusLabel(detailJob.status)}</span>
          </header>
          <section>
            <div>
              <span>{t("完整服务端异常", "Full server error")}</span>
              <button
                type="button"
                className="button text"
                onClick={() => {
                  void (async () => {
                    try {
                      if (window.janusGraphDesktop) {
                        await window.janusGraphDesktop.runtime.writeClipboard(detailJob.message);
                      } else if (navigator.clipboard) {
                        await navigator.clipboard.writeText(detailJob.message);
                      } else throw new Error("Clipboard API unavailable");
                      setCopyState("copied");
                    } catch {
                      setCopyState("failed");
                    }
                  })();
                }}
              >
                {copyState === "copied" ? <Check size={15} /> : <Copy size={15} />}
                {copyState === "copied"
                  ? t("已复制", "Copied")
                  : copyState === "failed"
                    ? t("复制失败，请重试", "Copy failed, retry")
                    : t("复制异常", "Copy error")}
              </button>
            </div>
            <pre>{detailJob.message}</pre>
          </section>
          {(detailJob.status === "failed" || detailJob.status === "interrupted") && (
            <footer className="schema-job-detail-actions">
              <button type="button" className="button secondary" onClick={() => onOpenDiagnostics({
                source: "schema",
                title: t("Schema 操作失败", "Schema operation failed"),
                connectionName: detailJob.connectionName,
                graphName: detailJob.indexName || undefined,
                stage: detailJob.action,
                message: detailJob.message,
                occurredAt: detailJob.updatedAt,
              })}>
                <Stethoscope size={16} />{t("生成诊断包", "Create diagnostic bundle")}
              </button>
            </footer>
          )}
          {/violates a uniqueness constraint.*SchemaName/i.test(detailJob.message) && (
            <aside>
              <AlertTriangle size={17} />
              <p>{t(
                "检测到重复 Schema 名称。通常是某个批次已经提交后又从头重试造成的；新版导入脚本会在服务端先检查已有定义，并仅在定义一致时安全跳过。请重新选择 Schema 文件生成新计划后再导入。",
                "A duplicate Schema name was detected, commonly caused by retrying from batch one after an earlier batch committed. New import plans check server-side definitions and safely skip matching ones. Select the Schema file again to generate a fresh plan before importing.",
              )}</p>
            </aside>
          )}
        </div>
      </Modal>
    )}
    {messageTooltip && createPortal(
      <div
        className="schema-job-message-tooltip"
        role="tooltip"
        style={{ left: messageTooltip.left, top: messageTooltip.top, width: messageTooltip.width }}
      >
        <span>{messageTooltip.message}</span>
        <small>{t("点击查看完整异常", "Click to view the full error")}</small>
      </div>,
      document.body,
    )}
    </>
  );
}
