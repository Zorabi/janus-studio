import type { QueryHistoryEntry } from "@janusgraph/domain";
import { Clock3, Code2, Search, Trash2 } from "lucide-react";
import { useState } from "react";
import { EmptyState, IconButton, PageHeader } from "../../components/ui";
import { useLocale, useTranslate } from "../../lib/i18n";
import { formatDate } from "../../lib/presentation";

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
  const filtered = history.filter(
    (entry) =>
      entry.query.toLowerCase().includes(search.toLowerCase()) ||
      entry.connectionName.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div className="page-scroll">
      <PageHeader
        eyebrow="LOCAL HISTORY"
        title={t("执行历史")}
        description={t(
          "查询成功和失败记录均保存在本机 SQLite 数据库中，不会上传到外部服务。",
          "Successful and failed queries are stored in local SQLite and never uploaded.",
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
      <div className="history-tools">
        <Search size={18} />
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={t("搜索语句或连接名称", "Search query or connection")}
          aria-label={t("搜索执行历史", "Search execution history")}
        />
        <span>{filtered.length} 条</span>
      </div>
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
              ? t("尝试修改搜索关键词。", "Try a different search term.")
              : t(
                  "成功或失败的查询执行后会自动出现在这里。",
                  "Queries appear here automatically after execution.",
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
                      {entry.status === "success" ? t("成功") : t("失败")}
                    </span>
                  </td>
                  <td>
                    <code title={entry.query}>{entry.query}</code>
                    {entry.errorMessage && <small>{entry.errorMessage}</small>}
                  </td>
                  <td>{entry.connectionName}</td>
                  <td>{entry.resultCount}</td>
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
