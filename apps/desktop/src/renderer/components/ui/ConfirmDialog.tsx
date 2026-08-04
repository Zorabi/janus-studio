import { AlertTriangle, LoaderCircle, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslate } from "../../lib/i18n";
import { Modal } from "./Modal";

export interface ConfirmDialogProps {
  title: string;
  description: string;
  confirmLabel: string;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
}

export function ConfirmDialog({
  title,
  description,
  confirmLabel,
  onCancel,
  onConfirm,
}: ConfirmDialogProps) {
  const t = useTranslate();
  const [busy, setBusy] = useState(false);

  return (
    <Modal title={title} eyebrow="CONFIRM ACTION" onClose={onCancel} width="narrow">
      <div className="confirm-content">
        <AlertTriangle size={28} />
        <p>{description}</p>
      </div>
      <footer className="modal-actions">
        <button type="button" className="button secondary" onClick={onCancel}>
          {t("取消", "Cancel")}
        </button>
        <button
          type="button"
          className="button danger"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            await onConfirm();
            setBusy(false);
          }}
        >
          {busy ? <LoaderCircle className="spin" size={17} /> : <Trash2 size={17} />}
          {confirmLabel}
        </button>
      </footer>
    </Modal>
  );
}
