import type { ReactNode } from "react";

export interface IconButtonProps {
  label: string;
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  tone?: "default" | "danger";
}

export function IconButton({
  label,
  children,
  onClick,
  disabled = false,
  tone = "default",
}: IconButtonProps) {
  return (
    <button
      type="button"
      className={`icon-button ${tone === "danger" ? "is-danger" : ""}`}
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}
