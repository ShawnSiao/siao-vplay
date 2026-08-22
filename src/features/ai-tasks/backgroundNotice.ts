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
): ToastNotice | null {
  if (update.status === "validating") return null;
  if (update.status === "rejected") {
    return {
      title: "结果未通过检查",
      message: "当前项目内容没有改变，可在对应功能中重新尝试。",
      tone: "warning",
    };
  }
  return { ...completedNotices[update.taskKind], tone: "success" };
}
