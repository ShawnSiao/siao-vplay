import { useState } from "react";
import type { ExternalResultFailure } from "../features/ai-tasks/useExternalAgentResults";
import "./ExternalResultNotice.css";

const messages: Record<ExternalResultFailure, string> = {
  scan: "暂时无法检查外部结果。应用会自动重试。",
  delivery: "外部结果状态暂未刷新。应用会自动重试。",
  acknowledgement: "外部结果通知暂未确认，可能再次显示。应用会自动重试。",
};
const slowMessages: Record<ExternalResultFailure, string> = {
  scan: "外部结果检查耗时较长，仍在等待响应。",
  delivery: "外部结果状态刷新耗时较长，仍在等待响应。",
  acknowledgement: "外部结果确认耗时较长，仍在等待响应。",
};
export function ExternalResultNotice({ failure, slowPhase, onRetry }: {
  failure: ExternalResultFailure | null; slowPhase: ExternalResultFailure | null; onRetry: () => Promise<void>;
}) {
  const [retrying, setRetrying] = useState(false);
  if (!failure && !slowPhase) return null;
  return <div className="notice external-result-notice" role="status" aria-live="polite">
    <span>{slowPhase ? `${slowMessages[slowPhase]}可继续观看；若持续无响应，可在保存编辑后重启应用。` : failure ? messages[failure] : ""}</span>
    <button className="button quiet" type="button" aria-label={slowPhase ? "外部结果仍在等待响应" : "重新检查外部结果"} disabled={retrying || slowPhase !== null}
      onClick={async () => {
        setRetrying(true);
        try { await onRetry(); } finally { setRetrying(false); }
      }}>{slowPhase ? "仍在等待…" : retrying ? "正在检查…" : "重新检查"}</button>
  </div>;
}
