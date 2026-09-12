import { expect, it, vi } from "vitest";
import { PlaybackSaveQueue } from "./playbackSaveQueue";

it("finishes queued writes before activating a replacement and ignores late callbacks", async () => {
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  const events: string[] = [];
  const queue = new PlaybackSaveQueue(async () => { events.push("begin"); return "token"; });
  queue.activate("A", 1);
  const first = queue.save("A", 1, async () => { events.push("write"); await pending; });
  await vi.waitFor(() => expect(events).toEqual(["begin", "write"]));
  queue.activate("A", 2);
  const late = vi.fn(); await queue.save("A", 1, late);
  expect(late).not.toHaveBeenCalled();
  expect(events).toEqual(["begin", "write"]);
  release(); await first;
  await queue.save("A", 2, async identity => {
    expect(identity).toEqual({ sessionId: "token", saveSequence: 1 });
    events.push("new write");
  });
  expect(events).toEqual(["begin", "write", "begin", "new write"]);
});

it("never saves without activation and retries a failed activation", async () => {
  const begin = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue("token");
  const queue = new PlaybackSaveQueue(begin);
  queue.activate("A", 1);
  const write = vi.fn();
  await expect(queue.save("A", 1, write)).rejects.toThrow("offline");
  expect(write).not.toHaveBeenCalled();
  await queue.save("A", 1, write);
  expect(write).toHaveBeenCalledWith({ sessionId: "token", saveSequence: 1 });
  expect(begin).toHaveBeenCalledTimes(2);
});

it("keeps sequence ordering after a failed write and isolates projects", async () => {
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  const queue = new PlaybackSaveQueue(async id => id);
  const first = queue.save("A", 1, async () => pending);
  const independent = vi.fn().mockResolvedValue(undefined);
  await queue.save("B", 2, independent);
  expect(independent).toHaveBeenCalledWith({ sessionId: "B", saveSequence: 1 });
  release(); await first;
  await expect(queue.save("A", 1, async identity => {
    expect(identity.saveSequence).toBe(2); throw new Error("disk full");
  })).rejects.toThrow("disk full");
  await queue.save("A", 1, async identity => { expect(identity.saveSequence).toBe(3); });
});
