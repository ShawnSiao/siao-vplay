import { useEffect } from "react";

type DialogProps = {
  title: string;
  eyebrow?: string;
  children: React.ReactNode;
  onClose: () => void;
  actions?: React.ReactNode;
};

export function Dialog({
  title,
  eyebrow,
  children,
  onClose,
  actions,
}: DialogProps) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div
      className="dialog-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <section
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
      >
        <button
          className="icon-button dialog-close"
          type="button"
          aria-label="关闭"
          onClick={onClose}
        >
          ×
        </button>
        {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
        <h2 id="dialog-title">{title}</h2>
        <div className="dialog-body">{children}</div>
        {actions ? <footer className="dialog-actions">{actions}</footer> : null}
      </section>
    </div>
  );
}
