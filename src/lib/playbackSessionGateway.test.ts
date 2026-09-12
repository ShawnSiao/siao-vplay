import { beforeEach, expect, it, vi } from "vitest";
import { beginPlaybackSession } from "./playbackSessionGateway";
const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => mocks);
beforeEach(() => { mocks.invoke.mockReset(); });
it("validates the backend-issued session token and preserves transport errors", async () => {
  for (const invalid of [null, "", {}, "local-session-1", "00000000-0000-0000-0000-000000000000"]) {
    mocks.invoke.mockResolvedValueOnce(invalid);
    await expect(beginPlaybackSession("A")).rejects.toThrow("播放保存会话数据无效");
  }
  const token = "00000000-0000-4000-8000-000000000001";
  mocks.invoke.mockResolvedValueOnce(token);
  await expect(beginPlaybackSession("A")).resolves.toBe(token);
  expect(mocks.invoke).toHaveBeenLastCalledWith("begin_playback_session", { projectId: "A" });
  const failure = { code: "database_error", message: "unavailable" };
  mocks.invoke.mockRejectedValueOnce(failure);
  await expect(beginPlaybackSession("A")).rejects.toBe(failure);
});
