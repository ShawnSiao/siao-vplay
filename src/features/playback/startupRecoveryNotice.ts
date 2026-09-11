import type { ToastNotice } from "../../components/AppToast";

export function startupRecoveryNotice(count: number): ToastNotice | null {
  if (count === 0) return null;
  return {
    title: "上次的原文字幕生成已中断",
    message: `${count} 项任务尚未完成。打开对应视频的字幕工具，可检查任务并重新开始。`,
    tone: "warning",
  };
}
