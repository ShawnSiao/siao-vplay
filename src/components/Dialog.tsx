import { useId } from "react";
import { isTopModal, useModalFocus } from "./useModalFocus";

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
  const dialogRef = useModalFocus(onClose);
  const titleId = useId();

  return (
    <div
      className="dialog-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && isTopModal(dialogRef.current)) {
          onClose();
        }
      }}
    >
      <section
        ref={dialogRef}
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <button
          className="icon-button dialog-close"
          type="button"
          aria-label="关闭"
          onClick={onClose}
        >
          ×
        </button>
        <header className="dialog-header">
          {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
          <h2 id={titleId}>{title}</h2>
        </header>
        <div className="dialog-body">{children}</div>
        {actions ? <footer className="dialog-actions">{actions}</footer> : null}
      </section>
    </div>
  );
}
