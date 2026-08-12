import { AlertTriangle, LoaderCircle, Trash2 } from "lucide-react";
import { type ReactNode, useState } from "react";
import { useTranslate } from "../../lib/i18n";
import { Modal } from "./Modal";

export interface ConfirmDialogProps {
  title: string;
  description: string;
  confirmLabel: string;
  confirmIcon?: ReactNode;
  confirmationText?: string;
  tone?: "danger" | "primary";
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
}

export function ConfirmDialog({
  title,
  description,
  confirmLabel,
  confirmIcon,
  confirmationText,
  tone = "danger",
  onCancel,
  onConfirm,
}: ConfirmDialogProps) {
  const t = useTranslate();
  const [busy, setBusy] = useState(false);
  const [typedConfirmation, setTypedConfirmation] = useState("");
  const confirmationMatches = !confirmationText || typedConfirmation === confirmationText;

  const confirm = async () => {
    if (!confirmationMatches || busy) return;
    setBusy(true);
    try {
      await onConfirm();
    } finally {
      setBusy(false);
    }
  };

  if (confirmationText) {
    return (
      <Modal title={title} eyebrow={tone === "danger" ? "IRREVERSIBLE OPERATION" : "CONFIRM TARGET"} onClose={onCancel} width="narrow">
        <form
          className="factory-drop-form"
          onSubmit={(event) => {
            event.preventDefault();
            void confirm();
          }}
        >
          <div className={`factory-drop-warning ${tone}`}>
            <AlertTriangle size={28} />
            <p>{description}</p>
          </div>
          <label className="field">
            <span>{t(`输入“${confirmationText}”以确认`, `Type “${confirmationText}” to confirm`)}</span>
            <input
              autoFocus
              value={typedConfirmation}
              onChange={(event) => setTypedConfirmation(event.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          <footer className="modal-actions">
            <button type="button" className="button secondary" onClick={onCancel}>
              {t("取消", "Cancel")}
            </button>
            <button type="submit" className={`button ${tone}`} disabled={busy || !confirmationMatches}>
              {busy ? <LoaderCircle className="spin" size={17} /> : confirmIcon ?? <Trash2 size={17} />}
              {confirmLabel}
            </button>
          </footer>
        </form>
      </Modal>
    );
  }

  return (
    <Modal title={title} eyebrow="CONFIRM ACTION" onClose={onCancel} width="narrow">
      <div className={`confirm-content ${tone}`}>
        <AlertTriangle size={28} />
        <p>{description}</p>
      </div>
      <footer className="modal-actions">
        <button type="button" className="button secondary" onClick={onCancel}>
          {t("取消", "Cancel")}
        </button>
        <button
          type="button"
          className={`button ${tone}`}
          disabled={busy || !confirmationMatches}
          onClick={() => void confirm()}
        >
          {busy ? <LoaderCircle className="spin" size={17} /> : confirmIcon ?? <Trash2 size={17} />}
          {confirmLabel}
        </button>
      </footer>
    </Modal>
  );
}
