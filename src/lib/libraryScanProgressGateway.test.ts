import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ listen: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => mocks);
vi.mock("./desktop", () => ({ isDesktopApp: true }));
import { listenLibraryScanProgress } from "../features/library/libraryGateway";
const progress = { scanId: "scan", phase: "scanning", scannedDirectories: 0, scannedFiles: 0, candidateFiles: 0, ignoredEntries: 0, currentRelativePath: null, message: null };
beforeEach(() => { mocks.listen.mockReset(); });
it.each(["scanning", "fingerprinting", "completed", "cancelled", "failed"])("accepts %s progress", async phase => {
  const value = { ...progress, phase };
  mocks.listen.mockImplementation(async (_name, handler) => { handler({ payload: value }); return vi.fn(); });
  const onProgress = vi.fn();
  await listenLibraryScanProgress(onProgress);
  expect(onProgress).toHaveBeenCalledExactlyOnceWith(value);
});
it("ignores malformed events and continues receiving valid progress", async () => {
  let receive!: (event: { payload: unknown }) => void;
  const stop = vi.fn();
  mocks.listen.mockImplementation(async (_name, handler) => { receive = handler; return stop; });
  const onProgress = vi.fn();
  const unlisten = await listenLibraryScanProgress(onProgress);
  for (const payload of [null, {}, { ...progress, phase: "unknown" }, { ...progress, scanId: " " }, { ...progress, scannedFiles: -1 }, { ...progress, candidateFiles: Number.MAX_SAFE_INTEGER + 1 }]) receive({ payload });
  expect(onProgress).not.toHaveBeenCalled();
  receive({ payload: progress });
  expect(onProgress).toHaveBeenCalledExactlyOnceWith(progress);
  unlisten();
  expect(stop).toHaveBeenCalledOnce();
});
