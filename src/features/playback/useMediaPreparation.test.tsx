import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MediaPreparation } from "../../types";
import { useMediaPreparation } from "./useMediaPreparation";

const gateway = vi.hoisted(() => ({ prepareProjectMedia: vi.fn(), getMediaPreparation: vi.fn(), cancelMediaPreparation: vi.fn() }));
vi.mock("../../lib/desktop", () => gateway);
function deferred() {
  let resolve!: (value: MediaPreparation) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<MediaPreparation>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
describe("useMediaPreparation", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    gateway.getMediaPreparation.mockResolvedValue(null);
    gateway.cancelMediaPreparation.mockResolvedValue(true);
  });

  it("waits for the owned worker to finish after cancellation is accepted", async () => {
    const worker = deferred();
    gateway.prepareProjectMedia.mockReturnValue(worker.promise);
    const { result } = renderHook(() => useMediaPreparation());
    let run!: Promise<unknown>;
    act(() => { run = result.current.start("a", false).catch((error: unknown) => error); });
    let cancel!: Promise<void>;
    let stopped = false;
    await act(async () => { cancel = result.current.cancel().then(() => { stopped = true; }); });
    expect(gateway.cancelMediaPreparation).toHaveBeenCalledWith(gateway.prepareProjectMedia.mock.calls[0][2]);
    expect(stopped).toBe(false);
    expect(result.current.cancelling).toBe(true);
    await act(async () => { worker.reject({ code: "cancelled" }); await run; await cancel; });
    expect(stopped).toBe(true);
    expect(result.current.canCancel).toBe(false);
  });

  it("retries cancellation that arrives before backend registration", async () => {
    const worker = deferred();
    gateway.prepareProjectMedia.mockReturnValue(worker.promise);
    gateway.cancelMediaPreparation.mockResolvedValueOnce(false).mockResolvedValue(true);
    const { result } = renderHook(() => useMediaPreparation());
    let run!: Promise<unknown>;
    act(() => { run = result.current.start("a", false).catch((error: unknown) => error); });
    let cancel!: Promise<void>;
    act(() => { cancel = result.current.cancel(); });
    await waitFor(() => expect(gateway.cancelMediaPreparation).toHaveBeenCalledTimes(2));
    await act(async () => { worker.reject({ code: "cancelled" }); await run; await cancel; });
  });

  it("does not cancel a previous request when another video starts opening", async () => {
    const first = deferred();
    const second = deferred();
    gateway.prepareProjectMedia.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const { result } = renderHook(() => useMediaPreparation());
    let firstRun!: Promise<unknown>;
    act(() => { firstRun = result.current.start("a", false); });
    act(() => result.current.reset());
    await act(() => result.current.cancel());
    expect(gateway.cancelMediaPreparation).not.toHaveBeenCalled();
    let secondRun!: Promise<unknown>;
    act(() => { secondRun = result.current.start("b", false); });
    await act(async () => { first.resolve({} as MediaPreparation); await firstRun; });
    expect(result.current.canCancel).toBe(true);
    await act(async () => { second.resolve({} as MediaPreparation); await secondRun; });
  });
});
