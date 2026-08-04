import { X } from "lucide-react";
import { type ReactNode, useEffect } from "react";
import { useTranslate } from "../../lib/i18n";
import { IconButton } from "./IconButton";

export interface ModalProps {
  title: string;
  eyebrow: string;
  onClose: () => void;
  children: ReactNode;
  width?: "narrow" | "wide";
}

export function Modal({
  title,
  eyebrow,
  onClose,
  children,
  width = "wide",
}: ModalProps) {
  const t = useTranslate();

  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [onClose]);

  return (
    <div className="modal-layer" role="presentation" onMouseDown={onClose}>
      <section
        className={`modal-card modal-${width}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="modal-header">
          <div>
            <span className="eyebrow">{eyebrow}</span>
            <h2 id="modal-title">{title}</h2>
          </div>
          <IconButton label={t("关闭", "Close")} onClick={onClose}>
            <X size={19} />
          </IconButton>
        </header>
        {children}
      </section>
    </div>
  );
}
