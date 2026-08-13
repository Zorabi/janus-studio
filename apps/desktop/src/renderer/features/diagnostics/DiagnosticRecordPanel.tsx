import type { DiagnosticRecord, DiagnosticRecordStatus } from "@janusgraph/domain";
import { Check, CheckCheck, ChevronDown, ChevronLeft, ChevronRight, CircleDot, History, RotateCcw, Trash2 } from "lucide-react";
import { Fragment, useEffect, useState } from "react";
import { useTranslate } from "../../lib/i18n";

const PAGE_SIZE = 8;

export function DiagnosticRecordPanel({ records, selectedId, onToggle, onStatus, onRemove }: {
  records: DiagnosticRecord[];
  selectedId?: string;
  onToggle: (record: DiagnosticRecord) => void;
  onStatus: (record: DiagnosticRecord, status: DiagnosticRecordStatus) => void;
  onRemove: (record: DiagnosticRecord) => void;
}) {
  const t = useTranslate();
  const [page, setPage] = useState(0);
  const statusLabel = (status: DiagnosticRecordStatus) => status === "unread"
    ? t("未读", "Unread") : status === "acknowledged" ? t("已确认", "Acknowledged") : t("已解决", "Resolved");
  const pageCount = Math.max(1, Math.ceil(records.length / PAGE_SIZE));
  const pageStart = page * PAGE_SIZE;
  const pageRecords = records.slice(pageStart, pageStart + PAGE_SIZE);
  const visiblePages = Array.from(new Set([0, page - 1, page, page + 1, pageCount - 1]))
    .filter((candidate) => candidate >= 0 && candidate < pageCount)
    .sort((left, right) => left - right);

  useEffect(() => {
    setPage((current) => Math.min(current, pageCount - 1));
  }, [pageCount]);
  useEffect(() => {
    const selectedIndex = records.findIndex((record) => record.id === selectedId);
    if (selectedIndex >= 0) setPage(Math.floor(selectedIndex / PAGE_SIZE));
  }, [records, selectedId]);

  return (
    <section className="diagnostic-records">
      <header><History size={18} /><div><strong>{t("诊断记录", "Diagnostic records")}</strong><small>{t("最多保留 200 条或 90 天", "Keep up to 200 records or 90 days")}</small></div><span>{records.length}</span></header>
      {records.length === 0 ? <p>{t("尚无持久化诊断记录", "No persisted diagnostic records yet")}</p> : <div className="diagnostic-record-list">
        {pageRecords.map((record) => <article className={`${selectedId === record.id ? "is-selected" : ""} is-${record.status}`} key={record.id}>
          <button type="button" className="diagnostic-record-main" aria-expanded={selectedId === record.id} onClick={() => onToggle(record)}>
            <span className="diagnostic-record-signal"><CircleDot size={15} /></span>
            <span><strong>{record.incident?.title || record.sourceName || t("自动诊断", "Automated diagnostic")}</strong><small>{[record.incident?.connectionName, record.incident?.graphName, new Date(record.updatedAt).toLocaleString()].filter(Boolean).join(" · ")}</small></span>
            <span className="diagnostic-record-tail">
              {record.occurrenceCount > 1 && <b>×{record.occurrenceCount}</b>}
              <em className="diagnostic-record-status">{statusLabel(record.status)}</em>
              <ChevronDown className="diagnostic-record-chevron" size={16} />
            </span>
          </button>
          {selectedId === record.id && <div className="diagnostic-record-actions">
            {record.status === "unread" && <button type="button" onClick={() => onStatus(record, "acknowledged")}><Check size={14} />{t("确认", "Acknowledge")}</button>}
            {record.status !== "resolved" && <button type="button" onClick={() => onStatus(record, "resolved")}><CheckCheck size={14} />{t("解决", "Resolve")}</button>}
            {record.status === "resolved" && <button type="button" onClick={() => onStatus(record, "acknowledged")}><RotateCcw size={14} />{t("重新打开", "Reopen")}</button>}
            <button type="button" className="is-danger" aria-label={t("删除诊断记录", "Delete diagnostic record")} onClick={() => onRemove(record)}><Trash2 size={14} /></button>
          </div>}
        </article>)}
        <footer className="diagnostic-record-pagination">
          <span>{pageStart + 1}–{Math.min(pageStart + PAGE_SIZE, records.length)} / {records.length}</span>
          <nav aria-label={t("诊断记录分页", "Diagnostic record pagination")}>
            <button type="button" disabled={page === 0} aria-label={t("上一页", "Previous page")} onClick={() => setPage((current) => current - 1)}><ChevronLeft size={16} /></button>
            {visiblePages.map((pageNumber, index) => <Fragment key={pageNumber}>
              {index > 0 && pageNumber - visiblePages[index - 1]! > 1 && <i>…</i>}
              <button type="button" className={pageNumber === page ? "is-current" : ""} aria-current={pageNumber === page ? "page" : undefined} onClick={() => setPage(pageNumber)}>{pageNumber + 1}</button>
            </Fragment>)}
            <button type="button" disabled={page >= pageCount - 1} aria-label={t("下一页", "Next page")} onClick={() => setPage((current) => current + 1)}><ChevronRight size={16} /></button>
          </nav>
        </footer>
      </div>}
    </section>
  );
}
