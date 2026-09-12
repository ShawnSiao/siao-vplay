type Props = { failed: boolean; loading: boolean; retry: () => void };

export function CodexDetectionNotice({ failed, loading, retry }: Props) {
  if (!failed) return null;
  return <div className="notice warning" role="alert">
    <p>本机 Codex 检测未完成，已有记录和其他处理方式仍可使用。</p>
    <button className="button quiet small" type="button" disabled={loading} onClick={retry}>
      {loading ? "正在检测…" : "重新检测 Codex"}
    </button>
  </div>;
}
