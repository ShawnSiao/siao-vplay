import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SubtitleVersion } from "../../types";
import { SubtitleTranscriptPanel } from "./SubtitleTranscriptPanel";
import { PlayerAuxiliaryDrawer } from "./PlayerAuxiliaryDrawer";

function version(role: SubtitleVersion["role"]): SubtitleVersion {
  return {
    id: `${role}-version`,
    trackId: role,
    projectId: "project",
    role,
    versionNumber: 1,
    status: "ready",
    sourceKind: role === "original" ? "transcription" : "agent_translation",
    sourceLabel: role,
    sourceSha256: role,
    mediaSha256: "media",
    languageCode: role === "original" ? "en" : "zh-cn",
    projectRevision: 1,
    parentVersionId: null,
    sourceTaskId: null,
    preflight: {} as SubtitleVersion["preflight"],
    createdAtMs: 1,
    isCurrent: true,
    segments: Array.from({ length: 3 }, (_, index) => ({
      id: `${role}-${index}`,
      lineageId: `${role}-${index}`,
      sourceSegmentId: null,
      issueKind: null,
      ordinal: index,
      startMs: index * 2_000,
      endMs: index * 2_000 + 1_500,
      text: role === "original" ? `original ${index}` : `译文 ${index}`,
      confidence: null,
      words: [],
    })),
  };
}

describe("SubtitleTranscriptPanel", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("resets full transcript permission when the actual drawer changes video or subtitle revision", () => {
    const source = version("original");
    const props = {
      activeTab: "transcript" as const, projectId: "project", mediaTitle: "Video A",
      contextLabel: "", contextStatus: "", episodeSummary: "", originalVersion: source,
      translatedVersion: null, activeOriginal: null, activeTranslation: null,
      episodeNavigation: { detail: null, episodes: [], neighbors: { previous: null, next: null }, loading: false, error: null },
      switchingEpisode: false, positionMs: 0, durationMs: 6000,
      onSelectTab: vi.fn(), onClose: vi.fn(), onSwitchEpisode: vi.fn(), onManageSubtitles: vi.fn(),
      onSeekTo: vi.fn(), onPausePlayback: vi.fn(),
    };
    const { rerender } = render(<PlayerAuxiliaryDrawer {...props} />);
    expect(screen.queryByRole("button", { name: /original 2/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "全部字幕（含后续剧情）" }));
    expect(screen.getByRole("button", { name: /original 2/ })).toBeInTheDocument();
    const next = { ...source, id: "video-b-version", projectId: "video-b" };
    rerender(<PlayerAuxiliaryDrawer {...props} projectId="video-b" mediaTitle="Video B" originalVersion={next} />);
    expect(screen.getByRole("button", { name: "当前及之前" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByRole("button", { name: /original 2/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "全部字幕（含后续剧情）" }));
    rerender(<PlayerAuxiliaryDrawer {...props} projectId="video-b" originalVersion={{ ...next, versionNumber: 2 }} />);
    expect(screen.queryByRole("button", { name: /original 2/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "当前及之前" })).toHaveAttribute("aria-pressed", "true");
  });

  it("highlights the current cue and pauses before seeking", () => {
    const calls: string[] = [];
    render(
      <SubtitleTranscriptPanel
        originalVersion={version("original")}
        translatedVersion={version("translation")}
        positionMs={2_500}
        onPause={() => calls.push("pause")}
        onSeekTo={(position) => calls.push(`seek:${position}`)}
      />,
    );
    expect(screen.getByRole("button", { name: /original 1/ })).toHaveAttribute(
      "aria-current",
      "true",
    );
    expect(screen.queryByRole("button", { name: /original 2/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "全部字幕（含后续剧情）" }));
    fireEvent.click(screen.getByRole("button", { name: /original 2/ }));
    expect(calls).toEqual(["pause", "seek:4000"]);
  });

  it("debounces visible text search without exposing internal identifiers", () => {
    render(
      <SubtitleTranscriptPanel
        originalVersion={version("original")}
        translatedVersion={null}
        positionMs={2_500}
        onPause={() => undefined}
        onSeekTo={() => undefined}
      />,
    );
    const search = screen.getByRole("searchbox", { name: "搜索逐字稿" });
    expect(screen.getAllByText("暂无译文")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "全部字幕（含后续剧情）" }));
    fireEvent.change(search, { target: { value: "original 2" } });
    act(() => vi.advanceTimersByTime(200));
    expect(screen.getAllByRole("button", { name: /original/ })).toHaveLength(1);
    fireEvent.change(search, { target: { value: "original-2" } });
    act(() => vi.advanceTimersByTime(200));
    expect(screen.getByText("没有匹配内容")).toBeInTheDocument();
  });

  it("window-renders lists of five hundred cues or more", () => {
    const source = version("original");
    source.segments = Array.from({ length: 501 }, (_, index) => ({
      ...source.segments[0],
      id: `long-${index}`,
      lineageId: `long-${index}`,
      ordinal: index,
      startMs: index * 2_000,
      endMs: index * 2_000 + 1_500,
      text: `long line ${index}`,
    }));
    const { container } = render(
      <SubtitleTranscriptPanel
        originalVersion={source}
        translatedVersion={null}
        positionMs={250_000}
        onPause={() => undefined}
        onSeekTo={() => undefined}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "全部字幕（含后续剧情）" }));
    expect(container.querySelector(".transcript-list-inner.virtualized")).not.toBeNull();
    expect(container.querySelectorAll(".transcript-cue").length).toBeLessThan(501);
  });

  it("pauses and resumes automatic following after a manual scroll intent", () => {
    render(
      <SubtitleTranscriptPanel
        originalVersion={version("original")}
        translatedVersion={null}
        positionMs={2_500}
        onPause={() => undefined}
        onSeekTo={() => undefined}
      />,
    );
    fireEvent.wheel(screen.getByRole("region", { name: "字幕列表" }));
    expect(screen.getByText("已暂停自动跟随")).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "回到当前句" })[0]);
    expect(screen.queryByText("已暂停自动跟随")).not.toBeInTheDocument();
  });
});
