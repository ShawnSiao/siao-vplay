import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, vi, type Mock } from "vitest";
import App from "./App";
import * as activity from "./features/summary/activityGateway";
import * as summaryGateway from "./features/summary/gateway";
import { createSummaryFixtures } from "./test-fixtures/summary";
import type { MediaPreparation, Project, SubtitleVersion } from "./types";

export async function verifySummaryWhileWatchingOtherVideo(
  outcome: "completed" | "failed", project: Project, preparation: MediaPreparation,
  mocks: Record<"getProject" | "markProjectOpened" | "prepareProjectMedia" | "listSubtitleVersions", Mock>,
  subtitle: SubtitleVersion,
) {
  const other = { ...project, id: "20000000-0000-4000-8000-000000000099", title: "视频 B" };
  let status: activity.SummaryActivity["status"] = "running";
  const fixtures = createSummaryFixtures();
  fixtures.summary.projectId = project.id;
  fixtures.summary.result.title = "A 的私有总结正文";
  const history = vi.spyOn(summaryGateway, "listVideoSummaries").mockResolvedValue(outcome === "completed" ? [fixtures.summary] : []);
  const tasks = vi.spyOn(summaryGateway, "listSummaryTasks").mockResolvedValue(outcome === "failed" ? [{ ...fixtures.task, projectId: project.id, status: "failed", errorMessage: "A 的总结失败原因" }] : []);
  mocks.listSubtitleVersions.mockImplementation(async (id: string) => id === project.id ? [subtitle] : []);
  const read = vi.spyOn(activity, "listSummaryActivity").mockImplementation(async () => ({
    incomplete: false, activities: [
      { id: "summary-a", projectId: project.id, projectTitle: "视频 A", status, hasResult: status === "completed", updatedAtMs: 1 },
      { id: "summary-b", projectId: other.id, projectTitle: other.title, status: "prepared", hasResult: false, updatedAtMs: 1 },
    ],
  }));
  mocks.getProject.mockImplementation(async (id: string) => id === other.id ? other : project);
  mocks.markProjectOpened.mockImplementation(async (id: string) => id === other.id ? other : project);
  mocks.prepareProjectMedia.mockImplementation(async (id: string) => ({
    ...preparation, inspection: { ...preparation.inspection, projectId: id },
  }));
  try {
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: /继续播放/ }));
    await screen.findByLabelText("视频画面，单击播放或暂停");
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.click(await screen.findByRole("button", { name: "处理动态" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: /视频 B/ }));
    await waitFor(() => expect(mocks.markProjectOpened).toHaveBeenCalledWith(other.id));
    const video = await screen.findByLabelText("视频画面，单击播放或暂停") as HTMLVideoElement;
    video.currentTime = 17.5;
    const pause = vi.spyOn(video, "pause");
    status = outcome;
    await screen.findByText(`「视频 A」的总结${outcome === "completed" ? "已完成" : "需要处理"}`, {}, { timeout: 4000 });
    expect(screen.getByLabelText("视频画面，单击播放或暂停")).toBe(video);
    expect(video.currentTime).toBe(17.5);
    expect(pause).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("视频总结历史结果")).not.toBeInTheDocument();
    expect(screen.queryByText("A 的私有总结正文")).not.toBeInTheDocument();
    expect(history).not.toHaveBeenCalled();
    pause.mockRestore();
    fireEvent.click(screen.getByRole("button", { name: "处理动态" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: /视频 A/ }));
    await waitFor(() => expect(mocks.markProjectOpened).toHaveBeenLastCalledWith(project.id));
    await screen.findByLabelText("视频画面，单击播放或暂停");
    fireEvent.click(await screen.findByRole("button", { name: "理解" }));
    fireEvent.click(await screen.findByRole("tab", { name: "视频总结" }));
    if (outcome === "completed") expect(await screen.findByRole("heading", { name: "A 的私有总结正文" })).toBeInTheDocument();
    else expect(await screen.findByText("A 的总结失败原因")).toBeInTheDocument();
    expect(history).toHaveBeenCalledWith(project.id);
  } finally { read.mockRestore(); history.mockRestore(); tasks.mockRestore(); }
}
