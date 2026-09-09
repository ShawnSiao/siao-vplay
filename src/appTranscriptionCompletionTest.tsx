import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, type Mock } from "vitest";
import App from "./App";
import type { Project, SubtitleVersion, TranscriptionJob } from "./types";

type Outcome = "completed" | "failed" | "interrupted" | "wrong-task" | "wrong-output";
type Context = {
  desktopMocks: Record<"startTranscription" | "getTranscriptionJob" | "listSubtitleVersions" | "getSubtitleVersion", Mock>;
  project: Project; subtitleVersion: SubtitleVersion; transcriptionJob: TranscriptionJob;
};
export async function verifyBackgroundTranscription(outcome: Outcome, { desktopMocks, project, subtitleVersion, transcriptionJob }: Context) {
  render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: /继续播放/ }));
  fireEvent.click(await screen.findByRole("button", { name: "添加字幕" }));
  fireEvent.click(screen.getByRole("tab", { name: "从视频生成" }));
  fireEvent.change(await screen.findByLabelText(/视频原声语言/), { target: { value: "ja" } });
  fireEvent.click(screen.getByRole("button", { name: "生成原文字幕" }));
  await waitFor(() => expect(desktopMocks.startTranscription).toHaveBeenCalled());
  desktopMocks.getTranscriptionJob.mockResolvedValue({ ...transcriptionJob,
    id: outcome === "wrong-task" ? "unrelated-job" : transcriptionJob.id,
    status: outcome === "failed" || outcome === "interrupted" ? outcome : "completed",
    stage: "completed", progress: 1, subtitleVersionId: subtitleVersion.id, completedAtMs: 1_785_354_220_000,
  });
  desktopMocks.getSubtitleVersion.mockClear();
  if (outcome === "wrong-output") desktopMocks.getSubtitleVersion.mockResolvedValue({ ...subtitleVersion, id: "unrelated-version" });
  desktopMocks.listSubtitleVersions.mockResolvedValue([subtitleVersion]);
  fireEvent.click(screen.getByRole("button", { name: "关闭" }));
  if (outcome === "completed") {
    expect(await screen.findByText("已生成 1 条原文字幕草稿，可以开始抽查。")).toBeInTheDocument();
    expect(desktopMocks.getSubtitleVersion).toHaveBeenCalledWith(project.id, subtitleVersion.id);
    expect(screen.getByRole("button", { name: "原文字幕 · 1" })).toBeInTheDocument();
  } else {
    const notices = {
      failed: "原文字幕生成失败，可重新打开字幕工具后重试。",
      interrupted: "原文字幕生成已中断，可重新打开字幕工具后重试。",
      "wrong-task": "字幕任务与当前视频不匹配，未采用返回结果。请重新打开字幕工具检查。",
      "wrong-output": "返回的字幕版本与任务不匹配，未采用结果。请重新打开字幕工具检查。",
    };
    expect(await screen.findByText(notices[outcome])).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "原文字幕 · 1" })).toBeNull();
    if (outcome !== "wrong-output") expect(desktopMocks.getSubtitleVersion).not.toHaveBeenCalled();
  }
}
