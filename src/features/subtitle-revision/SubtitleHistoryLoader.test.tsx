import { subtitleMetadata } from "./subtitleMetadata";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { SubtitleHistoryLoader } from "./SubtitleHistoryLoader";
import type { SubtitleVersion } from "../../types";
const read = vi.hoisted(() => vi.fn());
const metadata = vi.hoisted(() => vi.fn());
const paged = vi.hoisted(() => vi.fn());
vi.mock("../../lib/subtitleMetadataPageGateway", () => ({ readSubtitleMetadataPage: paged }));
vi.mock("../../lib/desktop", () => ({ listSubtitleVersions: read, listSubtitleVersionMetadata: metadata, commandError: (error: Error) => error }));
beforeEach(() => { read.mockReset(); metadata.mockReset().mockImplementation(async () => (await read.mock.results.at(-1)!.value).map(subtitleMetadata));
  paged.mockReset().mockImplementation(async () => { const items = await metadata(); return { projectId: "A", offset: 0, totalCount: items.length, nextOffset: null, snapshotToken: "a".repeat(64), items, currentVersions: items.filter((item: { isCurrent: boolean }) => item.isCurrent) }; }); });
const rows = (id: string) => [{ id, isCurrent: true, segments: [] }] as unknown as SubtitleVersion[];
const show = ({ currentVersions }: { currentVersions: SubtitleVersion[] }) => <p>{currentVersions[0]?.id}</p>;
it("uses the bounded page gateway while retaining an older current track", async () => {
  read.mockResolvedValue(rows("old-current"));
  const current = rows("old-current").map(subtitleMetadata);
  paged.mockResolvedValue({ projectId: "A", offset: 0, totalCount: 10000, nextOffset: 24, snapshotToken: "a".repeat(64),
    currentVersions: current, items: [{ ...current[0], id: "recent", isCurrent: false }] });
  render(<SubtitleHistoryLoader projectId="A" onClose={vi.fn()}>{show}</SubtitleHistoryLoader>);
  expect(await screen.findByText("old-current")).toBeInTheDocument();
  expect(paged).toHaveBeenCalledWith("A", 0);
  expect(metadata).not.toHaveBeenCalled();
});
it("clears the previous project while another history is loading", async () => {
  let finish!: (versions: SubtitleVersion[]) => void;
  read.mockResolvedValueOnce(rows("history-A")).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  const { rerender } = render(<SubtitleHistoryLoader projectId="A" onClose={vi.fn()}>{show}</SubtitleHistoryLoader>);
  expect(await screen.findByText("history-A")).toBeInTheDocument();
  rerender(<SubtitleHistoryLoader projectId="B" onClose={vi.fn()}>{show}</SubtitleHistoryLoader>);
  expect(screen.queryByText("history-A")).not.toBeInTheDocument();
  await act(async () => finish(rows("history-B")));
  expect(await screen.findByText("history-B")).toBeInTheDocument();
  expect(read).toHaveBeenLastCalledWith("B", false);
});
it("allows retry after a local read failure", async () => {
  const close = vi.fn();
  read.mockRejectedValueOnce(new Error("读取失败")).mockResolvedValueOnce(rows("restored-history"));
  render(<SubtitleHistoryLoader projectId="A" onClose={close}>{show}</SubtitleHistoryLoader>);
  expect(await screen.findByRole("alert")).toHaveTextContent("读取失败");
  fireEvent.click(screen.getByRole("button", { name: "重新读取" }));
  expect(await screen.findByText("restored-history")).toBeInTheDocument();
  expect(read).toHaveBeenCalledTimes(2);
});
it("does not deliver a late response after dismissal", async () => {
  let finish!: (versions: SubtitleVersion[]) => void;
  const child = vi.fn(show);
  const close = vi.fn();
  read.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  const { unmount } = render(<SubtitleHistoryLoader projectId="A" onClose={close}>{child}</SubtitleHistoryLoader>);
  fireEvent.click(screen.getByRole("button", { name: "关闭" }));
  expect(close).toHaveBeenCalledOnce();
  unmount();
  await act(async () => finish(rows("late")));
  expect(child).not.toHaveBeenCalled();
});

it("does not present a partial catalog when metadata fails", async () => {
  read.mockResolvedValue(rows("current-track"));
  metadata.mockRejectedValueOnce(new Error("版本列表读取失败"));
  render(<SubtitleHistoryLoader projectId="A" onClose={vi.fn()}>{show}</SubtitleHistoryLoader>);
  expect(await screen.findByRole("alert")).toHaveTextContent("版本列表读取失败");
  expect(screen.queryByText("current-track")).not.toBeInTheDocument();
});

it("rejects a catalog changed between metadata and content reads", async () => {
  read.mockResolvedValue(rows("new-current"));
  metadata.mockResolvedValue([{ id: "old-current", isCurrent: true, segmentCount: 0 }]);
  render(<SubtitleHistoryLoader projectId="A" onClose={vi.fn()}>{show}</SubtitleHistoryLoader>);
  expect(await screen.findByRole("alert")).toHaveTextContent("字幕版本已变化，请重新读取");
  expect(screen.queryByText("new-current")).not.toBeInTheDocument();
});
