import type { ResolverDisclosure } from "../features/library/usePublicResolverConsent";

type Props = { disclosure: ResolverDisclosure | null; error: boolean; authorized: boolean; disabled: boolean; onChange: (value: boolean) => void };
export function PublicResolverConsent({ disclosure, error, authorized, disabled, onChange }: Props) {
  return <section className="remote-url-notice" aria-label="第三方解析说明">
    <p>先直接读取 X 公开页面。可选择在直接解析失败时使用第三方服务。</p>
    {disclosure ? <>
      <p>接收服务：{disclosure.receiver}。将发送所填帖子的编号，不发送本地视频、字幕或本机路径。</p>
      <label><input type="checkbox" checked={authorized} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />允许直接解析失败后向上述服务发送帖子编号</label>
    </> : <p>{error ? "无法确认第三方接收服务，本次仅使用直接解析。" : "正在读取接收服务配置…"}</p>}
  </section>;
}
