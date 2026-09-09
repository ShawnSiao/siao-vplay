import { useState } from "react";
import type { ExternalResultFailure } from "../features/ai-tasks/useExternalAgentResults";
import "./ExternalResultNotice.css";

const messages: Record<ExternalResultFailure, string> = {
  scan: "暂时无法检查外部结果。应用会自动重试。",
  delivery: "外部结果状态暂未刷新。应用会自动重试。",
  acknowledgement: "外部结果通知暂未确认，可能再次显示。应用会自动重试。",
};
export function ExternalResultNotice({ failure, onRetry }: {
  failure: ExternalResultFailure | null; onRetry: () => Promise<void>;
}) {
  const [retrying, setRetrying] = useState(false);
  if (!failure) return null;
  return <div className="notice external-result-notice" role="status" aria-live="polite">
    <span>{messages[failure]}</span>
    <button className="button quiet" type="button" aria-label="重新检查外部结果" disabled={retrying}
      onClick={async () => {
        setRetrying(true);
        try { await onRetry(); } finally { setRetrying(false); }
      }}>{retrying ? "正在检查…" : "重新检查"}</button>
  </div>;
}
