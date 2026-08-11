import { AlertTriangle, Copy, Hash, LoaderCircle, Table2, X } from "lucide-react";
import { DataGrid } from "../../components/DataGrid";
import { EmptyState, IconButton } from "../../components/ui";
import { useTranslate } from "../../lib/i18n";
import {
  orderedInspectorEntries,
  printableValue,
  type ScalarResult,
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

function scalarDisplayValue(scalar: ScalarResult) {
  if (typeof scalar.value === "number") return scalar.value.toLocaleString();
  if (typeof scalar.value === "bigint") return scalar.value.toLocaleString();
  return printableValue(scalar.value);
}

export function TableResult({
  rows,
  rawItems,
  scalar,
}: {
  rows: ResultRow[];
  rawItems: unknown[];
  scalar: ScalarResult | null;
}) {
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
  if (scalar) {
    const value = scalarDisplayValue(scalar);
    const typeLabel = {
      string: t("文本", "String"),
      number: t("数字", "Number"),
      boolean: t("布尔值", "Boolean"),
      bigint: t("大整数", "Big integer"),
      null: "Null",
      undefined: "Undefined",
    }[scalar.type];
    return (
      <div className="scalar-result-stage">
        <article className="scalar-result-card">
          <header>
            <span className="scalar-result-icon"><Hash size={20} /></span>
            <div>
              <span className="eyebrow">SCALAR RESULT</span>
              <strong>{t("单值结果", "Single value")}</strong>
            </div>
            <span className="scalar-result-type">{typeLabel}</span>
          </header>
          <div className="scalar-result-value" title={value}>{value || "—"}</div>
          <footer>
            <span>{t("查询返回了一个标量值，无需使用行列视图。", "The query returned one scalar value; a row-and-column view is unnecessary.")}</span>
            <button type="button" onClick={() => void navigator.clipboard.writeText(value)}>
              <Copy size={15} />{t("复制值", "Copy value")}
            </button>
          </footer>
        </article>
      </div>
    );
  }
  return <DataGrid rows={rows} rawItems={rawItems} />;
}

