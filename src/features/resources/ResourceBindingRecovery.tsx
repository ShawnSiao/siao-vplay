import type { ResourceLocationResult } from "../../types";
export function ResourceBindingRecovery({ result, busy, onRetry }: { result: ResourceLocationResult | null; busy: boolean; onRetry: () => void }) {
  if (!result) return null;
  return <div className="notice danger" role="alert">
    <strong>保存位置已保留，任务状态尚未恢复</strong>
    <p>当前保存位置：{result.resourceRoot}</p><p>{result.bindingError}</p>
    <p>恢复只重新加载任务状态，不会重新保存位置或下载资源。</p>
    <button className="button quiet" type="button" disabled={busy} onClick={onRetry}>恢复任务状态</button>
  </div>;
}
