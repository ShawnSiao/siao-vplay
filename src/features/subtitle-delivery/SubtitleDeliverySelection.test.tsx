import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { SubtitleDeliveryDialog } from "../../components/SubtitleDeliveryDialog";
import type { Project, SubtitleVersion } from "../../types";
const mocks = vi.hoisted(() => ({ jobs: vi.fn().mockResolvedValue([]), export: vi.fn().mockRejectedValue(new Error("停止于导出边界")) }));
vi.mock("../../lib/desktop", () => ({ listSubtitleBurnJobs: mocks.jobs, getSubtitleBurnJob: vi.fn(),
  chooseSubtitleDeliveryDirectory: async () => "destination", exportSubtitles: mocks.export,
  cancelSubtitleBurnJob: vi.fn(), resumeSubtitleBurnJob: vi.fn(), startSubtitleBurn: vi.fn(), commandError: (error: Error) => error }));
const current = { id: "current", trackId: "t", projectId: "p", role: "original" as const, versionNumber: 3,
  status: "ready" as const, sourceLabel: "当前", languageCode: "en", createdAtMs: 1, isCurrent: true, segmentCount: 2 };
it("retains the explicitly chosen export version across metadata pages", async () => {
  const historical = { ...current, id: "chosen", versionNumber: 2, isCurrent: false };
  const renderPage = (items: typeof current[]) => <SubtitleDeliveryDialog project={{ id: "p" } as Project} versions={items}
    currentSubtitle={{ ...current, segments: [] } as unknown as SubtitleVersion} currentTranslation={null} onClose={vi.fn()} />;
  const { rerender } = render(renderPage([current, historical]));
  await waitFor(() => expect(mocks.jobs).toHaveBeenCalled());
  fireEvent.change(screen.getByRole("combobox", { name: "原文字幕版本" }), { target: { value: "chosen" } });
  fireEvent.click(screen.getByRole("checkbox"));
  rerender(renderPage([current, { ...historical, id: "another", versionNumber: 1 }]));
  expect(screen.getByRole("combobox", { name: "原文字幕版本" })).toHaveValue("chosen");
  expect(screen.getByRole("checkbox")).toBeChecked();
  fireEvent.click(screen.getByRole("button", { name: "选择位置并导出" }));
  await waitFor(() => expect(mocks.export).toHaveBeenCalledWith("p", "original", "srt", "chosen", null, "destination"));
});

it("does not label a retained selection as current after the catalog changes", async () => {
  const renderPage = (items: typeof current[]) => <SubtitleDeliveryDialog project={{ id: "p" } as Project} versions={items}
    currentSubtitle={{ ...current, segments: [] } as unknown as SubtitleVersion} currentTranslation={null} onClose={vi.fn()} />;
  const { rerender } = render(renderPage([current]));
  await waitFor(() => expect(screen.getByRole("button", { name: "选择位置并导出" })).toBeDisabled());
  rerender(renderPage([{ ...current, id: "new-current", versionNumber: 4 }]));
  expect(screen.getByRole("combobox", { name: "原文字幕版本" })).toHaveValue("current");
  expect(screen.getByRole("option", { name: "原文 · 版本 3" })).toBeInTheDocument();
});
