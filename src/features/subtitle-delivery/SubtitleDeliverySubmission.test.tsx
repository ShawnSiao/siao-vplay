import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { SubtitleDeliveryDialog } from "../../components/SubtitleDeliveryDialog";
import type { Project, SubtitleVersion } from "../../types";
import { createBurnJobFixture } from "../../test-fixtures/burn";
const mocks = vi.hoisted(() => ({ jobs: vi.fn(), choose: vi.fn(), export: vi.fn() }));
vi.mock("../../lib/desktop", () => ({ listSubtitleBurnJobs: mocks.jobs, getSubtitleBurnJob: vi.fn(),
  chooseSubtitleDeliveryDirectory: mocks.choose, exportSubtitles: mocks.export,
  cancelSubtitleBurnJob: vi.fn(), resumeSubtitleBurnJob: vi.fn(), startSubtitleBurn: vi.fn(), commandError: (error: Error) => error }));
const source = { id: "source", trackId: "t", projectId: "p", role: "original" as const, versionNumber: 1,
  status: "ready" as const, sourceLabel: "原文", languageCode: "en", createdAtMs: 1, isCurrent: true, segmentCount: 1 };
beforeEach(() => { vi.clearAllMocks(); mocks.jobs.mockResolvedValue([]); mocks.export.mockRejectedValue(new Error("fixture export failure")); });
async function setup() {
  const rendered = render(<SubtitleDeliveryDialog project={{ id: "p" } as Project} versions={[source]}
    currentSubtitle={{ ...source, segments: [] } as unknown as SubtitleVersion} currentTranslation={null} onClose={vi.fn()} />);
  await waitFor(() => expect(screen.queryByText("正在读取本地任务…")).not.toBeInTheDocument());
  fireEvent.click(screen.getByRole("checkbox"));
  return rendered;
}
it("admits only one pending directory selection", async () => {
  let resolve!: (path: string | null) => void;
  mocks.choose.mockReturnValue(new Promise<string | null>(yes => { resolve = yes; }));
  await setup();
  const submit = screen.getByRole("button", { name: "选择位置并导出" });
  fireEvent.click(submit); fireEvent.click(submit);
  expect(mocks.choose).toHaveBeenCalledTimes(1);
  expect(submit).toBeDisabled();
  await act(async () => { resolve(null); });
  expect(screen.getByRole("button", { name: "选择位置并导出" })).toBeEnabled();
});
it("does not export when the directory picker returns after the dialog is gone", async () => {
  let resolve!: (path: string) => void;
  mocks.choose.mockReturnValue(new Promise<string>(yes => { resolve = yes; }));
  const view = await setup();
  fireEvent.click(screen.getByRole("button", { name: "选择位置并导出" }));
  view.unmount();
  await act(async () => { resolve("destination"); });
  expect(mocks.export).not.toHaveBeenCalled();
});

it("invalidates pending selection immediately when close is requested", async () => {
  let resolve!: (path: string) => void;
  mocks.choose.mockReturnValue(new Promise<string>(yes => { resolve = yes; }));
  await setup();
  fireEvent.click(screen.getByRole("button", { name: "选择位置并导出" }));
  fireEvent.click(screen.getByRole("button", { name: /^取消$/ }));
  await act(async () => { resolve("destination"); });
  expect(mocks.export).not.toHaveBeenCalled();
});

it("releases admission after picker failure so the confirmed selection can be retried", async () => {
  mocks.choose.mockRejectedValueOnce(new Error("目录暂不可用")).mockResolvedValueOnce("destination");
  await setup();
  fireEvent.click(screen.getByRole("button", { name: "选择位置并导出" }));
  await screen.findByText("目录暂不可用");
  expect(screen.getByRole("checkbox")).toBeChecked();
  fireEvent.click(screen.getByRole("button", { name: "选择位置并导出" }));
  await waitFor(() => expect(mocks.export).toHaveBeenCalledWith("p", "original", "srt", "source", null, "destination"));
});

it("retries failed burn history without losing export choices or hiding export errors", async () => {
  mocks.jobs.mockRejectedValueOnce(new Error("历史暂不可用")).mockResolvedValueOnce([]);
  mocks.choose.mockResolvedValue("destination");
  await setup();
  fireEvent.change(screen.getByRole("combobox", { name: "字幕文件格式" }), { target: { value: "vtt" } });
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: "选择位置并导出" }));
  await screen.findByText("fixture export failure");
  expect(screen.getByText("历史暂不可用")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "重新读取烧录记录" }));
  await waitFor(() => expect(mocks.jobs).toHaveBeenCalledTimes(2));
  expect(screen.getByRole("combobox", { name: "字幕文件格式" })).toHaveValue("vtt");
  expect(screen.getByRole("checkbox")).toBeChecked();
  expect(screen.getByText("fixture export failure")).toBeInTheDocument();
  expect(mocks.export).toHaveBeenCalledTimes(1);
});

it("recovers an interrupted burn after retry without silently starting another job", async () => {
  mocks.jobs.mockRejectedValueOnce(new Error("历史暂不可用"))
    .mockResolvedValueOnce([{ ...createBurnJobFixture(), projectId: "p", status: "interrupted", stage: "interrupted" }]);
  await setup();
  fireEvent.click(screen.getByRole("button", { name: "重新读取烧录记录" }));
  const recent = await screen.findByRole("button", { name: /最近一次烧录/ });
  fireEvent.click(recent);
  expect(screen.getByRole("button", { name: "重新开始" })).toBeEnabled();
  expect(mocks.choose).not.toHaveBeenCalled();
  expect(mocks.export).not.toHaveBeenCalled();
});
