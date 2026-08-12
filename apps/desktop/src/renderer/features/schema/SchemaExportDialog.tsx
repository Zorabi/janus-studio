import { AlertTriangle, Download, FileArchive, FileJson, LoaderCircle } from "lucide-react";
import { useState } from "react";
import { Modal } from "../../components/ui";
import { useTranslate } from "../../lib/i18n";

export type SchemaExportFormat = "official" | "studio";

export function SchemaExportDialog({
  graphName,
  unavailableReasons,
  busy,
  onClose,
  onExport,
}: {
  graphName: string;
  unavailableReasons: Partial<Record<SchemaExportFormat, string>>;
  busy: SchemaExportFormat | null;
  onClose: () => void;
  onExport: (format: SchemaExportFormat) => void;
}) {
  const t = useTranslate();
  const [selected, setSelected] = useState<SchemaExportFormat>("official");
  const formats: Array<{
    value: SchemaExportFormat;
    icon: typeof FileJson;
    title: string;
    badge: string;
    description: string;
    fileName: string;
  }> = [
    {
      value: "official",
      icon: FileJson,
      title: t("JanusGraph 官方 JSON", "Official JanusGraph JSON"),
      badge: "JsonSchemaDefinition",
      description: t("纯官方格式，可直接交给 JsonSchemaInitStrategy 导入。", "Pure native format for direct import through JsonSchemaInitStrategy."),
      fileName: `${graphName}.janusgraph-schema.json`,
    },
    {
      value: "studio",
      icon: FileArchive,
      title: t("Janus Studio 迁移归档", "Janus Studio migration archive"),
      badge: "janus-studio.schema/v1",
      description: t("包含来源、导出时间和官方定义，适合跨连接迁移与冲突审阅。", "Includes source, export time, and native definitions for migration and conflict review."),
      fileName: `${graphName}.schema.json`,
    },
  ];

  return (
    <Modal eyebrow="SCHEMA EXPORT" title={t("选择 Schema 导出格式", "Choose Schema Export Format")} onClose={onClose} width="wide">
      <div className="schema-export-dialog">
        <div className="schema-export-target">
          <span>{t("当前图", "Current graph")}</span>
          <strong>{graphName}</strong>
        </div>
        <div className="schema-export-options" role="radiogroup" aria-label={t("Schema 导出格式", "Schema export formats")}>
          {formats.map((format) => {
            const Icon = format.icon;
            const unavailableReason = unavailableReasons[format.value] ?? "";
            return (
              <button
                type="button"
                key={format.value}
                className={selected === format.value ? "is-selected" : ""}
                role="radio"
                aria-checked={selected === format.value}
                disabled={Boolean(unavailableReason) || busy !== null}
                onClick={() => setSelected(format.value)}
              >
                <span className="schema-export-icon"><Icon size={23} /></span>
                <span className="schema-export-copy">
                  <span><strong>{format.title}</strong><code>{format.badge}</code></span>
                  <small>{format.description}</small>
                  <code>{format.fileName}</code>
                  {unavailableReason && <em>{unavailableReason}</em>}
                </span>
                <span className="schema-export-radio" aria-hidden="true" />
              </button>
            );
          })}
        </div>
        {unavailableReasons[selected] && (
          <div className="schema-export-disabled" role="status">
            <AlertTriangle size={18} />
            <span><strong>{t("所选格式当前不可用", "The selected format is unavailable")}</strong><small>{unavailableReasons[selected]}</small></span>
          </div>
        )}
        <footer className="modal-actions">
          <button type="button" className="button secondary" disabled={busy !== null} onClick={onClose}>{t("取消", "Cancel")}</button>
          <button type="button" className="button primary" disabled={Boolean(unavailableReasons[selected]) || busy !== null} onClick={() => onExport(selected)}>
            {busy ? <LoaderCircle className="spin" size={17} /> : <Download size={17} />}
            {busy ? t("正在导出", "Exporting") : t("导出所选格式", "Export selected format")}
          </button>
        </footer>
      </div>
    </Modal>
  );
}
