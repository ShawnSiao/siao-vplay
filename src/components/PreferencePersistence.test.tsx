import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppToast, type ToastNotice } from "./AppToast";
import { usePreferenceNotices } from "./usePreferenceNotices";
import { PlayerDrawer } from "../features/playback/PlayerDrawer";
import { saveLibrarySection, storedLibrarySection } from "../features/library/librarySectionState";
import { useSeekStepPreference, useSubtitleDisplayPreferences } from "../features/playback/playbackPreferences";

function Harness() {
  const [notice, setNotice] = useState<ToastNotice | null>(null);
  usePreferenceNotices(setNotice);
  const seek = useSeekStepPreference();
  const subtitle = useSubtitleDisplayPreferences();
  return <>
    <button onClick={() => seek.changeSeekStep(30)}>步长 {seek.seekStepSeconds}</button>
    <button onClick={() => subtitle.changeSubtitleDisplayPreferences({ ...subtitle.subtitleDisplayPreferences, textSize: "large" })}>字号 {subtitle.subtitleDisplayPreferences.textSize}</button>
    <PlayerDrawer activeTab="learn" mediaTitle="测试视频" onSelectTab={() => {}} onClose={() => {}}>正文</PlayerDrawer>
    {notice && <AppToast notice={notice} onDismiss={() => setNotice(null)} />}
  </>;
}

beforeEach(() => { vi.restoreAllMocks(); localStorage.clear(); });

describe("preference persistence feedback", () => {
  it("preserves session edits and shows a warning when writes fail", () => {
    render(<Harness />);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota"); });
    fireEvent.click(screen.getByRole("button", { name: "步长 10" }));
    expect(screen.getByRole("button", { name: "步长 30" })).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent("无法保存设置，本次更改仅临时生效。");
    fireEvent.click(screen.getByRole("button", { name: "字号 medium" }));
    expect(screen.getByRole("button", { name: "字号 large" })).toBeVisible();
    fireEvent.click(screen.getByText("阅读设置"));
    fireEvent.click(screen.getByRole("button", { name: "紧凑" }));
    expect(screen.getByRole("complementary")).toHaveAttribute("data-density", "compact");
  });

  it("does not write on mount or overwrite future drawer preferences", () => {
    const raw = JSON.stringify({ version: 2, value: "compact" });
    localStorage.setItem("siaovplay-preferences.drawer-density", raw);
    const writes = vi.spyOn(Storage.prototype, "setItem");
    render(<Harness />);
    expect(writes).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("阅读设置"));
    fireEvent.click(screen.getByRole("button", { name: "紧凑" }));
    expect(screen.getByRole("status")).toHaveTextContent("已保留其他版本的设置");
    expect(localStorage.getItem("siaovplay-preferences.drawer-density")).toBe(raw);
  });

  it("handles inaccessible library preferences without throwing", () => {
    vi.spyOn(window, "localStorage", "get").mockImplementation(() => { throw new Error("denied"); });
    expect(storedLibrarySection()).toBe("home");
    expect(saveLibrarySection("folders")).toBe("unavailable");
  });
});
