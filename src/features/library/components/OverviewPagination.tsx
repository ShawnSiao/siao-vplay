type Props = {
  offset: number; count: number; totalCount: number | null; hasNext: boolean; loading: boolean; error: string | null;
  onPrevious: () => Promise<boolean>; onNext: () => Promise<boolean>; onRetry: () => Promise<boolean>; onReload: () => Promise<boolean>;
};
export function OverviewPagination(props: Props) {
  return <div className="library-overview-pagination">
    <span aria-live="polite">{props.totalCount === null ? "" : `共 ${props.totalCount} 个${props.count ? `，${props.offset + 1}–${props.offset + props.count}` : ""}`}</span>
    {props.loading ? <span role="status">正在读取…</span> : null}
    {props.error ? <span className="library-inline-error" role="alert">{props.error}</span> : null}
    <button type="button" disabled={props.loading || props.offset === 0} onClick={() => void props.onPrevious()}>上一页</button>
    <button type="button" disabled={props.loading || !props.hasNext || Boolean(props.error)} onClick={() => void props.onNext()}>下一页</button>
    {props.error ? <button type="button" disabled={props.loading} onClick={() => void props.onRetry()}>重试读取</button> : null}
    <button type="button" disabled={props.loading} onClick={() => void props.onReload()}>重新加载</button>
  </div>;
}
