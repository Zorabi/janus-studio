import type { QueryHistoryEntry, QueryHistoryStatus } from "@janusgraph/domain";
import { Clock3, Code2, Search, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { SelectControl } from "../../components/SelectControl";
import { EmptyState, IconButton, PageHeader } from "../../components/ui";
import { useLocale, useTranslate } from "../../lib/i18n";
import { formatDate } from "../../lib/presentation";
import {
  filterQueryHistory,
  type HistoryDateFilter,
  type HistoryStatusFilter,
} from "./history-filters";

export interface HistoryPageProps {
  history: QueryHistoryEntry[];
  onUse: (entry: QueryHistoryEntry) => void;
  onRemove: (entry: QueryHistoryEntry) => void;
  onClear: () => void;
}

export function HistoryPage({
  history,
  onUse,
  onRemove,
  onClear,
}: HistoryPageProps) {
  const t = useTranslate();
  const locale = useLocale();
  const [search, setSearch] = useState("");
  const [connectionId, setConnectionId] = useState("");
  const [status, setStatus] = useState<HistoryStatusFilter>("all");
  const [date, setDate] = useState<HistoryDateFilter>("all");
  const connections = useMemo(
    () => [
      ...new Map(
        [...history]
          .reverse()
          .map((entry) => [entry.connectionId, entry.connectionName]),
      ).entries(),
    ].map(([value, label]) => ({ value, label })),
    [history],
  );
  const filtered = useMemo(
    () => filterQueryHistory(history, { search, connectionId, status, date }),
    [connectionId, date, history, search, status],
  );
  const statusLabel = (value: QueryHistoryStatus) => {
    if (value === "success") return t("成功", "Success");
    if (value === "error") return t("失败", "Failed");
    if (value === "cancelled") return t("已取消", "Cancelled");
    return t("已截断", "Truncated");
  };

  return (
    <div className="page-scroll">
      <PageHeader
        eyebrow="LOCAL HISTORY"
        title={t("执行历史")}
        description={t(
          "查询成功、失败、取消和结果截断记录均保存在本机 SQLite 数据库中，不会上传到外部服务。",
          "Successful, failed, cancelled, and truncated queries are stored in local SQLite and never uploaded.",
        )}
        actions={
          history.length > 0 ? (
            <button type="button" className="button danger ghost" onClick={onClear}>
              <Trash2 size={17} />
              {t("清空历史")}
            </button>
          ) : undefined
        }
      />
      <div className="history-tools history-filter-tools">
        <div className="history-search">
          <Search size={18} />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t("搜索语句、连接或错误", "Search query, connection, or error")}
            aria-label={t("搜索执行历史", "Search execution history")}
          />
        </div>
        <SelectControl
          className="history-filter-select"
          ariaLabel={t("连接筛选", "Connection filter")}
          value={connectionId}
          onValueChange={setConnectionId}
          options={[
            { value: "", label: t("全部连接", "All connections") },
            ...connections,
          ]}
        />
        <SelectControl
          className="history-filter-select"
          ariaLabel={t("状态筛选", "Status filter")}
          value={status}
          onValueChange={(value) => setStatus(value as HistoryStatusFilter)}
          options={[
            { value: "all", label: t("全部状态", "All statuses") },
            { value: "success", label: t("成功", "Success") },
            { value: "error", label: t("失败", "Failed") },
            { value: "cancelled", label: t("已取消", "Cancelled") },
            { value: "truncated", label: t("已截断", "Truncated") },
          ]}
        />
        <SelectControl
          className="history-filter-select"
          ariaLabel={t("日期范围", "Date range")}
          value={date}
          onValueChange={(value) => setDate(value as HistoryDateFilter)}
          options={[
            { value: "all", label: t("全部时间", "All time") },
            { value: "today", label: t("今天", "Today") },
            { value: "7d", label: t("最近 7 天", "Last 7 days") },
            { value: "30d", label: t("最近 30 天", "Last 30 days") },
          ]}
        />
        <span>{filtered.length} {t("条", "records")}</span>
      </div>
      {history.length > 0 && (
        <p className="history-filter-scope">
          {t(
            "筛选范围为当前已载入的最近记录；可在偏好设置中调整历史记录上限。",
            "Filters apply to the recent records currently loaded. Adjust the history limit in Preferences.",
          )}
        </p>
      )}
      {filtered.length === 0 ? (
        <EmptyState
          icon={<Clock3 size={31} />}
          title={
            history.length
              ? t("没有匹配的历史", "No matching history")
              : t("还没有执行记录", "No execution records yet")
          }
          description={
            history.length
              ? t("尝试修改搜索内容或筛选条件。", "Try another search or filter.")
              : t(
                  "查询执行后会自动出现在这里，包括取消和结果截断状态。",
                  "Queries appear here automatically, including cancellations and truncated results.",
                )
          }
        />
      ) : (
        <div className="history-table-wrap">
          <table className="history-table">
            <thead>
              <tr>
                <th>{t("状态", "Status")}</th>
                <th>{t("查询语句", "Query")}</th>
                <th>{t("连接", "Connection")}</th>
                <th>{t("结果", "Results")}</th>
                <th>{t("耗时", "Duration")}</th>
                <th>{t("时间", "Time")}</th>
                <th>{t("操作", "Actions")}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((entry) => (
                <tr key={entry.id}>
                  <td>
                    <span className={`badge ${entry.status}`}>
                      {statusLabel(entry.status)}
                    </span>
                  </td>
                  <td>
                    <code title={entry.query}>{entry.query}</code>
                    {entry.errorMessage && <small>{entry.errorMessage}</small>}
                  </td>
                  <td>{entry.connectionName}</td>
                  <td>
                    {entry.status === "success" || entry.status === "truncated"
                      ? entry.resultCount
                      : "—"}
                  </td>
                  <td>{entry.durationMs} ms</td>
                  <td>{formatDate(entry.createdAt, locale)}</td>
                  <td>
                    <div className="row-actions">
                      <button
                        type="button"
                        className="button text"
                        onClick={() => onUse(entry)}
                      >
                        <Code2 size={16} />
                        {t("载入")}
                      </button>
                      <IconButton
                        label={t("删除此记录", "Delete this record")}
                        tone="danger"
                        onClick={() => onRemove(entry)}
                      >
                        <Trash2 size={16} />
                      </IconButton>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
