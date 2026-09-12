import { useState } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LibraryMediaSummary, Project } from "../../types";
import { usePosterQueue } from "./usePosterQueue";
const desktopMocks = vi.hoisted(() => ({ ensureProjectPoster: vi.fn() }));
vi.mock("../../lib/desktop", () => desktopMocks);
const project = (id: string, posterPath: string | null = null) => ({ id, title: id, revision: 1,
  mediaSource: { locator: `${id}.mp4`, posterPath }, playbackState: { positionMs: 0 } }) as Project;
const media = (id: string) => ({ projectId: id, mediaLocator: `${id}.mp4`, mediaAvailable: true, durationMs: 1000, posterPath: null }) as LibraryMediaSummary;
function setup(items: LibraryMediaSummary[]) {
  const refresh = vi.fn();
  return { refresh, ...renderHook(() => {
    const [active, setActive] = useState<Project | null>(project(items[0].projectId));
    usePosterQueue({ enabled: true, media: items, refreshLibrary: refresh, setActiveProject: setActive });
    return { active, setActive };
  }) };
}
describe("usePosterQueue", () => {
  beforeEach(() => desktopMocks.ensureProjectPoster.mockReset());
  it("generates loaded missing posters serially without repeating before list refresh", async () => {
    let finish!: (value: Project) => void;
    desktopMocks.ensureProjectPoster.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }))
      .mockResolvedValueOnce(project("B", "B.jpg"));
    const { refresh } = setup([media("A"), media("B")]);
    await waitFor(() => expect(desktopMocks.ensureProjectPoster).toHaveBeenCalledTimes(1));
    expect(desktopMocks.ensureProjectPoster).toHaveBeenLastCalledWith("A");
    await act(async () => finish(project("A", "A.jpg")));
    await waitFor(() => expect(refresh).toHaveBeenCalled(), { timeout: 2000 });
    expect(desktopMocks.ensureProjectPoster.mock.calls).toEqual([["A"], ["B"]]);
  });
  it("merges only the poster when playback changes during generation", async () => {
    let finish!: (value: Project) => void;
    desktopMocks.ensureProjectPoster.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const { result } = setup([media("A")]);
    act(() => result.current.setActive({ ...project("A"), title: "新标题", revision: 9, playbackState: { positionMs: 900 } as Project["playbackState"] }));
    await act(async () => finish(project("A", "A.jpg")));
    expect(result.current.active?.title).toBe("新标题");
    expect(result.current.active?.revision).toBe(9);
    expect(result.current.active?.playbackState.positionMs).toBe(900);
    expect(result.current.active?.mediaSource.posterPath).toBe("A.jpg");
  });
  it("does not apply a poster from the old media location after relinking", async () => {
    let finish!: (value: Project) => void;
    desktopMocks.ensureProjectPoster.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const { result } = setup([media("A")]);
    act(() => result.current.setActive({ ...project("A"), mediaSource: { ...project("A").mediaSource, locator: "new.mp4" } }));
    await act(async () => finish(project("A", "old.jpg")));
    expect(result.current.active?.mediaSource.posterPath).toBeNull();
  });
});
