type PlayerErrorCardProps = {
  message: string;
  onDismiss: () => void;
  onRetry: () => void;
};

export function PlayerErrorCard({
  message,
  onDismiss,
  onRetry,
}: PlayerErrorCardProps) {
  return (
    <aside className="player-error-card" role="alert">
      <span className="player-error-mark" aria-hidden="true">!</span>
      <div>
        <h2>无法读取这个视频</h2>
        <p>{message}</p>
      </div>
      <small>原文件、字幕版本和观看记录没有改变。</small>
      <div className="player-error-actions">
        <button className="button quiet" type="button" onClick={onDismiss}>
          稍后处理
        </button>
        <button className="button danger" type="button" onClick={onRetry}>
          重新检查
        </button>
      </div>
    </aside>
  );
}
