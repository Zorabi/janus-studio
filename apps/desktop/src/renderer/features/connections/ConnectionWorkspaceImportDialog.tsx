import { connectionEndpoint } from "@janusgraph/application";
import { AlertTriangle, ArrowDownToLine, Check, KeyRound, LoaderCircle, ShieldCheck } from "lucide-react";
import { useMemo, useState } from "react";
import { Modal } from "../../components/ui";
import { useTranslate } from "../../lib/i18n";
import type { ConnectionImportPlanRow } from "../../lib/connection-workspace";
import { connectionImportInput } from "../../lib/connection-workspace";
import { errorMessage } from "../../lib/presentation";

export function ConnectionWorkspaceImportDialog({
  sourceName,
  rows,
  onClose,
  onImported,
}: {
  sourceName: string;
  rows: ConnectionImportPlanRow[];
  onClose: () => void;
  onImported: () => void | Promise<void>;
}) {
  const t = useTranslate();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const counts = useMemo(() => ({
    create: rows.filter((row) => row.status === "create").length,
    update: rows.filter((row) => row.status === "update").length,
    skip: rows.filter((row) => row.status === "skip").length,
    conflict: rows.filter((row) => row.status === "conflict").length,
  }), [rows]);
  const actionable = counts.create + counts.update;

  const importConnections = async () => {
    setBusy(true);
    setMessage("");
    try {
      for (const row of rows) {
        if (row.status !== "create" && row.status !== "update") continue;
        await window.janusGraphDesktop!.connections.save(connectionImportInput(row));
      }
      await onImported();
      onClose();
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={t("审阅连接导入", "Review connection import")} eyebrow="CONNECTION WORKSPACE" width="wide" onClose={onClose}>
      <div className="connection-import-review">
        <section className="connection-import-source">
          <ArrowDownToLine size={20} />
          <div>
            <strong>{sourceName}</strong>
            <p>{t("凭据、Token、私钥内容、敏感 Header 和本机证书路径不会从归档导入。", "Credentials, tokens, private-key contents, sensitive headers and local certificate paths are never imported from the archive.")}</p>
          </div>
          <ShieldCheck size={20} />
        </section>

        <div className="connection-import-counts" aria-label={t("导入变更概览", "Import change summary")}>
          <span><strong>{counts.create}</strong>{t("新增", "Create")}</span>
          <span><strong>{counts.update}</strong>{t("更新", "Update")}</span>
          <span><strong>{counts.skip}</strong>{t("相同并跳过", "Unchanged")}</span>
          <span className={counts.conflict ? "is-warning" : ""}><strong>{counts.conflict}</strong>{t("名称冲突", "Name conflicts")}</span>
        </div>

        <div className="connection-import-list">
          {rows.map((row, index) => (
            <article className={`connection-import-row status-${row.status}`} key={`${row.sourceId || row.input.name}-${index}`}>
              <div className="connection-import-row-main">
                <strong>{row.input.name}</strong>
                <code>{connectionEndpoint(row.input)}</code>
                <small>{row.input.groupName || t("未分组", "Ungrouped")} · {row.input.graphBinding} / {row.input.traversalSource}</small>
              </div>
              {row.credentialKinds.length > 0 && (
                <span className="connection-import-credential" title={row.credentialKinds.join(", ")}>
                  <KeyRound size={13} />{t("导入后补充凭据", "Credentials required")}
                </span>
              )}
              <span className="connection-import-status">
                {row.status === "create" ? t("新增", "Create")
                  : row.status === "update" ? t("覆盖现有配置", "Update existing")
                    : row.status === "skip" ? t("跳过", "Skip")
                      : t("名称冲突，已阻止", "Name conflict blocked")}
              </span>
            </article>
          ))}
        </div>

        {counts.conflict > 0 && (
          <div className="connection-import-warning"><AlertTriangle size={17} />{t("同名但目标不同的连接不会自动覆盖。请先重命名现有连接或修改归档后重试。", "Connections with the same name but a different target are not overwritten. Rename the existing connection or edit the archive before retrying.")}</div>
        )}
        {message && <div className="form-message error">{message}</div>}
        <footer className="modal-footer connection-import-footer">
          <button type="button" className="button secondary" onClick={onClose} disabled={busy}>{t("取消", "Cancel")}</button>
          <button type="button" className="button primary" onClick={() => void importConnections()} disabled={busy || actionable === 0}>
            {busy ? <LoaderCircle className="spin" size={17} /> : <Check size={17} />}
            {t("导入连接", "Import connections")} · {actionable}
          </button>
        </footer>
      </div>
    </Modal>
  );
}
