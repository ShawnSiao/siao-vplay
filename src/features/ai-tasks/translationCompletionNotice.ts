import type { ToastNotice } from "../../components/AppToast";

export function translationCompletionNotice(
  task: { segmentCount: number; validation: { warningCount: number } | null },
  currentProject: boolean,
): ToastNotice {
  if (task.validation?.warningCount) {
    return {
      title: "中文字幕草稿已生成",
      message: `${currentProject ? "" : "请打开对应视频查看。"}另有 ${task.validation.warningCount} 项一致性提示，建议抽查后再使用。`,
      tone: "warning",
    };
  }
  return {
    title: "中文字幕已准备好",
    message: `已生成 ${task.segmentCount} 条草稿，${currentProject ? "当前视频可以切换为中文或双语字幕。" : "可返回媒体库打开对应视频查看。"}`,
    tone: "success",
  };
}
