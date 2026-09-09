import type { ToastNotice } from "../../components/AppToast";
import type { ExternalAgentResultUpdate } from "../../types";

const completedNotices = {
  translation: {
    title: "中文字幕已准备好",
    message: "当前视频可以切换为中文或双语字幕。",
  },
  explanation: {
    title: "当前场景解释已准备好",
    message: "打开「理解」查看结合当前剧情的可能解读。",
  },
  learning: {
    title: "词义结果已准备好",
    message: "打开「学习」继续查询或收藏。",
  },
} as const;

export function backgroundResultNotice(
  update: ExternalAgentResultUpdate,
  currentProject = true,
): ToastNotice | null {
  if (update.status === "validating") return null;
  if (!currentProject) {
    return update.status === "rejected"
      ? { title: "后台结果未通过检查", message: "其他视频的结果未被采用，可打开对应视频重新尝试。", tone: "warning" }
      : { title: "后台结果已准备好", message: "其他视频的处理已完成，可返回媒体库打开对应视频查看。", tone: "success" };
  }
  if (update.status === "rejected") {
    return {
      title: "结果未通过检查",
      message: "当前项目内容没有改变，可在对应功能中重新尝试。",
      tone: "warning",
    };
  }
  return { ...completedNotices[update.taskKind], tone: "success" };
}
