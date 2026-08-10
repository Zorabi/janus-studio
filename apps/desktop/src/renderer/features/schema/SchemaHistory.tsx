import type { SchemaJob, SchemaJobStatus } from "@janusgraph/domain";
import {
  Clock3,
  History,
  RotateCcw,
  Search,
  Trash2,
} from "lucide-react";
import { useMemo, useState } from "react";
import { SelectControl } from "../../components/SelectControl";
import { EmptyState, IconButton } from "../../components/ui";
import { useLocale, useTranslate } from "../../lib/i18n";
import { formatDate } from "../../lib/presentation";

type StatusFilter = "all" | SchemaJobStatus;

export function SchemaHistory({
  jobs,
  busy,
  onRetry,
  onDismiss,
}: {
  jobs: SchemaJob[];
  busy: boolean;
  onRetry: (job: SchemaJob) => void;
  onDismiss: (job: SchemaJob) => void;
}) {
  const t = useTranslate();
  const locale = useLocale();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
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
                    {job.message && <small title={job.message}>{job.message}</small>}
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
                          {t("重试", "Retry")}
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
  );
}
