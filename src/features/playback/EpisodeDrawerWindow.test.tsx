import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { importedDetail, mediaSummary } from "../library/libraryControllerTestFixtures";
import { EpisodeDrawer } from "./EpisodeDrawer";
function propsFor(count: number) {
  return { detail: importedDetail, projectId: "episode-73", mediaTitle: "正在播放的视频", episodes: Array.from({ length: count }, (_, index) => ({
    ...mediaSummary(`episode-${index + 1}`), episodeNumber: index + 1, itemAvailability: "available" as const })),
    neighbors: { previous: null, next: null }, loading: false, error: null, switching: false,
    playbackPositionMs: 5000, playbackDurationMs: 10000, onSwitch: vi.fn() };
}
it.each([120, 1000, 10000])("bounds %i loaded episodes and starts on the playing page", count => {
  const props = propsFor(count);
  const { container } = render(<EpisodeDrawer {...props} />);
  expect(container.querySelectorAll(".episode-drawer-list button")).toHaveLength(24);
  expect(container.querySelector('[aria-current="true"]')).toHaveTextContent("视频 episode-73");
  fireEvent.click(screen.getByRole("button", { name: "上一页剧集" }));
  expect(screen.getByText("视频 episode-49")).toBeVisible();
  expect(container.querySelector(".episode-drawer-list button")).toHaveFocus();
  expect(screen.getByText(/正在播放的视频/)).toBeVisible();
  fireEvent.click(container.querySelector<HTMLButtonElement>(".episode-drawer-list button")!);
  expect(props.onSwitch).toHaveBeenCalledWith(expect.objectContaining({ projectId: "episode-49" }));
  fireEvent.click(screen.getByRole("button", { name: "下一页剧集" }));
  expect(container.querySelector('[aria-current="true"]')).toHaveTextContent("视频 episode-73");
});
it("resets the window to a new project's page", () => {
  const props = propsFor(120);
  const { rerender } = render(<EpisodeDrawer {...props} />);
  fireEvent.click(screen.getByRole("button", { name: "上一页剧集" }));
  rerender(<EpisodeDrawer {...props} projectId="episode-1" />);
  expect(screen.getByText("视频 episode-1")).toBeVisible();
  expect(screen.queryByText("视频 episode-49")).toBeNull();
});
it("keeps the playing episode header independent from the visible server page", () => {
  const props = propsFor(24);
  render(<EpisodeDrawer {...props} currentEpisode={{ ...mediaSummary("episode-73"),
    episodeTitle: "播放中的第七十三集", seasonNumber: 1, episodeNumber: 73,
  }} />);
  expect(screen.getByText("第 1 季 · 第 73 集")).toBeVisible();
  expect(screen.getByText(/播放中的第七十三集/)).toBeVisible();
});
it("routes a failed previous-page retry to the failed read rather than next page", () => {
  const props = propsFor(24), retry = vi.fn().mockResolvedValue(false), loadMore = vi.fn();
  render(<EpisodeDrawer {...props} pagination={{ items: props.episodes, offset: 24, totalCount: 100,
    nextOffset: 48, loading: false, error: "读取失败", retry, loadMore, reload: vi.fn(), loadPrevious: vi.fn(),
  }} />);
  fireEvent.click(screen.getByRole("button", { name: "重试读取剧集" }));
  expect(retry).toHaveBeenCalledOnce();
  expect(loadMore).not.toHaveBeenCalled();
  expect(screen.queryByRole("button", { name: "下一页剧集" })).toBeNull();
});
