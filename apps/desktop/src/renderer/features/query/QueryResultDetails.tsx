import { AlertTriangle, LoaderCircle, Table2, X } from "lucide-react";
import { DataGrid } from "../../components/DataGrid";
import { EmptyState, IconButton } from "../../components/ui";
import { useTranslate } from "../../lib/i18n";
import {
  orderedInspectorEntries,
  printableValue,
  type ResultRow,
} from "../../lib/result-model";
import type {
  Selection,
  SelectionDetailState,
} from "./query-workspace";

export function ElementInspector({
  selection,
  onClose,
  detailState,
}: {
  selection: Selection;
  onClose: () => void;
  detailState: SelectionDetailState;
}) {
  const t = useTranslate();
  if (!selection) return null;
  const { value } = selection;
  const identity =
    selection.kind === "node"
      ? { ID: value.id, LABEL: value.label }
      : {
          ID: selection.value.id,
          LABEL: selection.value.label,
          FROM: selection.value.from,
          TO: selection.value.to,
        };
  return (
    <aside className="element-inspector" aria-label={t("图元素详情", "Graph element details")}>
      <header>
        <div>
          <span className="eyebrow">
            {selection.kind === "node" ? "VERTEX DETAIL" : "EDGE DETAIL"}
          </span>
          <h3>{value.label}</h3>
        </div>
        <IconButton label={t("关闭详情")} onClick={onClose}>
          <X size={18} />
        </IconButton>
      </header>
      {detailState.status === "loading" && (
        <div className="inspector-status is-loading" role="status">
          <LoaderCircle className="spin" size={17} />
          <span>
            {t(
              "正在读取 JanusGraph 中的完整属性…",
              "Loading complete properties from JanusGraph…",
            )}
          </span>
        </div>
      )}
      {detailState.status === "error" && (
        <div className="inspector-status is-error" role="alert">
          <AlertTriangle size={17} />
          <span>{detailState.message}</span>
        </div>
      )}
      <dl className="property-list">
        {orderedInspectorEntries({ ...identity, ...value.properties }).map(([key, entry]) => (
          <div key={key}>
            <dt>{key}</dt>
            <dd>{printableValue(entry)}</dd>
          </div>
        ))}
      </dl>
    </aside>
  );
}

export function TableResult({ rows, rawItems }: { rows: ResultRow[]; rawItems: unknown[] }) {
  const t = useTranslate();
  if (rows.length === 0) {
    return (
      <EmptyState
        icon={<Table2 size={30} />}
        title={t("查询成功，结果为空")}
        description={t("服务器返回了零条记录。")}
      />
    );
  }
  return <DataGrid rows={rows} rawItems={rawItems} />;
}


