import "./AppToast.css";

export type ToastNotice =
  | string
  | {
      title: string;
      message?: string;
      tone?: "success" | "warning" | "neutral";
    };

type AppToastProps = {
  notice: ToastNotice;
  onDismiss: () => void;
};

export function AppToast({ notice, onDismiss }: AppToastProps) {
  const structured = typeof notice !== "string";
  const title = structured ? notice.title : notice;
  const message = structured ? notice.message : undefined;
  const tone = structured ? notice.tone ?? "neutral" : "neutral";

  return (
    <div className={`toast toast-${tone}`} role="status" aria-live="polite">
      <span className="toast-mark" aria-hidden="true">
        {tone === "success" ? "✓" : tone === "warning" ? "!" : "i"}
      </span>
      <span className="toast-copy">
        <strong>{title}</strong>
        {message ? <span>{message}</span> : null}
      </span>
      <button
        aria-label="关闭通知"
        className="toast-close"
        type="button"
        onClick={onDismiss}
      >
        ×
      </button>
    </div>
  );
}
