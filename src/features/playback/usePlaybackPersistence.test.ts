import { act, renderHook } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Project } from "../../types";
import { usePlaybackPersistence } from "./usePlaybackPersistence";
const update = vi.hoisted(() => vi.fn());
vi.mock("../../lib/desktop", () => ({ updatePlaybackState: update, beginPlaybackSession: async () => "00000000-0000-4000-8000-000000000001" }));
const values = { positionMs: 100, durationMs: 1_000, volume: 1, playbackRate: 1, subtitleMode: "bilingual" as const };
const project = (id: string, positionMs = 0): Project => ({
  id, title: id, revision: 1, status: "ready", createdAtMs: 0, updatedAtMs: 0, lastOpenedAtMs: 0,
  mediaSource: {} as Project["mediaSource"],
  playbackState: { ...values, positionMs, completedAtMs: null, updatedAtMs: 0 },
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function setup() {
  const currentSession = { current: 1 };
  const onFailure = vi.fn();
  const hook = renderHook(({ sessionId }) => {
    const [active, setActive] = useState<Project | null>(project("A"));
    const persist = usePlaybackPersistence({ project: active, sessionId, currentSession,
      setProject: setActive, onFailure });
    return { active, setActive, persist };
  }, { initialProps: { sessionId: 1 } });
  return { ...hook, currentSession, onFailure };
}
describe("playback persistence sessions", () => {
  beforeEach(() => { update.mockReset(); });
  it("does not restore A after B is opened", async () => {
    const pending = deferred<Project>(); update.mockReturnValue(pending.promise);
    const { result, rerender, currentSession } = setup();
    let save!: Promise<void>;
    act(() => { save = result.current.persist(values); });
    currentSession.current = 2;
    act(() => result.current.setActive(project("B")));
    rerender({ sessionId: 2 });
    await act(async () => { pending.resolve(project("A", 100)); await save; });
    expect(result.current.active?.id).toBe("B");
  });
  it("serializes saves for one project without blocking another project", async () => {
    const pending = deferred<Project>(); update.mockReturnValueOnce(pending.promise).mockImplementation(async (id, v) => project(id, v.positionMs));
    const { result, rerender, currentSession } = setup();
    let first!: Promise<void>; let second!: Promise<void>;
    await act(async () => { first = result.current.persist(values); second = result.current.persist({ ...values, positionMs: 200 }); });
    expect(update).toHaveBeenCalledTimes(1);
    currentSession.current = 2;
    act(() => result.current.setActive(project("B"))); rerender({ sessionId: 2 });
    await act(async () => { await result.current.persist({ ...values, positionMs: 300 }); });
    expect(update.mock.calls.map((call) => call[0])).toEqual(["A", "B"]);
    await act(async () => { pending.resolve(project("A", 100)); await Promise.all([first, second]); });
    expect(result.current.active?.id).toBe("B");
    expect(update.mock.calls.at(-1)?.[1].positionMs).toBe(200);
  });
  it("rejects stale UI writes even after reopening the same project", async () => {
    const pending = deferred<Project>(); update.mockReturnValue(pending.promise);
    const { result, rerender, currentSession } = setup();
    let save!: Promise<void>; act(() => { save = result.current.persist(values); });
    currentSession.current = 2;
    act(() => result.current.setActive(project("A", 500))); rerender({ sessionId: 2 });
    await act(async () => { pending.resolve(project("A", 100)); await save; });
    expect(result.current.active?.playbackState.positionMs).toBe(500);
  });
  it("reports failures and allows the next save to retry without rolling back other fields", async () => {
    update.mockRejectedValueOnce(new Error("private path must not leak")).mockResolvedValue(project("A", 200));
    const { result, onFailure } = setup();
    await act(async () => { await expect(result.current.persist(values)).rejects.toThrow(); });
    expect(onFailure).toHaveBeenCalledOnce();
    expect(onFailure.mock.calls[0][0]).not.toContain("private path");
    act(() => result.current.setActive({ ...project("A"), title: "new title", revision: 2 }));
    await act(async () => { await result.current.persist({ ...values, positionMs: 200 }); });
    expect(result.current.active?.title).toBe("new title");
    expect(result.current.active?.revision).toBe(2);
  });
});
