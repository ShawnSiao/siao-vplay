import { MenuPopover } from "../../components/MenuPopover";
import type { ToastNotice } from "../../components/AppToast";
import type { LibrarySearchResult } from "../../types";
import type { SummaryActivity } from "./activityGateway";
import { useSummaryCompletionNotice } from "./useSummaryCompletionNotice";
import "./summary-activity.css";

const statusLabels: Record<SummaryActivity["status"], string> = {
  prepared: "等待开始", awaiting_external_result: "等待导入结果", queued: "等待处理",
  running: "正在总结", paused: "已暂停", validating: "正在检查结果",
  completed: "已完成", failed: "处理失败，可重试", cancelled: "已取消", interrupted: "已中断，可继续",
};
type Props = { onNotice: (notice: ToastNotice) => void; onOpen: (result: LibrarySearchResult) => void };
export function SummaryActivityMenu({ onNotice, onOpen }: Props) {
  const { activities, error, incomplete } = useSummaryCompletionNotice(onNotice);
  return <MenuPopover constrainToViewport label="处理动态" className="summary-activity" triggerClassName="shell-command" panelClassName="summary-activity-menu"
    trigger={<><span aria-hidden="true">◷</span><span>动态</span></>}>
    <p>最近 100 项视频总结</p>
    {error ? <p role="status">暂时无法刷新；保留上次记录，稍后自动重试。</p> : incomplete ? <p role="status">有动态未通过检查；仅显示已验证的记录，稍后自动重试。</p> : null}
    {!activities.length && !error && !incomplete ? <p>还没有视频总结。</p> : null}
    {activities.map((task) => <button key={task.id} type="button" role="menuitem" onClick={() => onOpen({
      kind: "unclassified", title: task.projectTitle, subtitle: null, projectId: task.projectId,
      collectionId: null, seasonNumber: null, episodeNumber: null,
    })}>
      <strong>{task.projectTitle}</strong>
      <span>{task.status === "completed" && !task.hasResult ? "总结结果暂不可用" : statusLabels[task.status]}</span>
      <small>打开视频 → 理解 → 视频总结</small>
    </button>)}
  </MenuPopover>;
}
