import { formatBytes } from "../environment-settings/localResourcePresentation";
import "./ResourcePreparationAction.css";

type Props = {
  downloadBytes: number;
  installedBytes: number;
  path: string | null;
  busy: boolean;
  configured: boolean;
  canPrepare: boolean;
  preparing: boolean;
  unavailable: boolean;
  disabled: boolean;
  onPrepare: () => void;
};

export function ResourcePreparationAction(props: Props) {
  const label = props.busy ? "正在建立准备任务…"
    : !props.configured ? "确认位置并开始准备"
    : props.canPrepare ? "开始准备所选功能"
    : props.preparing ? "正在准备所选功能"
    : props.unavailable ? "当前不能开始准备" : "所选功能已准备";
  return <div className="local-resources-preparation-action">
    <p>本次下载 {formatBytes(props.downloadBytes)} · 安装后约 {formatBytes(props.installedBytes)}</p>
    <small title={props.path ?? undefined}>保存到：{props.path ?? "请先选择保存位置"}</small>
    <button className="button primary local-resources-primary-action" type="button" disabled={props.disabled} onClick={props.onPrepare}>
      {label}
    </button>
  </div>;
}
