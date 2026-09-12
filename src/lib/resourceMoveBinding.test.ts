import { beforeEach, expect, it, vi } from "vitest";
import { moveLocalResourceRoot, planLocalResourceMove } from "./desktop";
const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
beforeEach(() => mocks.invoke.mockReset());
const plan = { planFingerprint: "a".repeat(64), previousRoot: "W:/old", selectedParent: "W:/new", resourceRoot: "W:/new/SiaoVPlay", bytesToCopy: 10, fileCount: 1, freeSpaceBytes: null, crossVolume: false, destinationExists: false, confirmationRequired: true };
const result = { planFingerprint: plan.planFingerprint, requestId: "request-1", previousRoot: plan.previousRoot,
  currentRoot: plan.resourceRoot, copiedBytes: 10, verifiedFileCount: 1, crossVolume: false, previousRootRetained: true };
it.each([
  { ...result, planFingerprint: "b".repeat(64) }, { ...result, requestId: "other" },
  { ...result, previousRoot: "W:/other" }, { ...result, currentRoot: "W:/other" },
  { ...result, copiedBytes: 11 }, { ...result, verifiedFileCount: 2 }, { ...result, crossVolume: true },
])("rejects a result from a different confirmed move %#", async value => {
  mocks.invoke.mockResolvedValue(value); await expect(moveLocalResourceRoot(plan, "request-1")).rejects.toThrow();
});
it("requires a fingerprint in a move preview", async () => {
  mocks.invoke.mockResolvedValue({ ...plan, planFingerprint: undefined }); await expect(planLocalResourceMove(plan.selectedParent)).rejects.toThrow();
});

it("passes the confirmed plan identity unchanged and accepts its exact acknowledgement", async () => {
  mocks.invoke.mockResolvedValue(result); await expect(moveLocalResourceRoot(plan, "request-1")).resolves.toEqual(result);
  expect(mocks.invoke).toHaveBeenCalledWith("move_local_resource_root", { input: { parentPath: plan.selectedParent, confirmed: true, planFingerprint: plan.planFingerprint }, requestId: "request-1" });
});
it("does not send a move without a valid confirmed snapshot", async () => {
  await expect(moveLocalResourceRoot({ ...plan, planFingerprint: "" }, "request-1")).rejects.toThrow();
  expect(mocks.invoke).not.toHaveBeenCalled();
});

it("keeps the reviewed snapshot while the caller changes its displayed plan", async () => {
  const selected = { ...plan };
  let start!: () => void; const started = new Promise<void>(resolve => { start = resolve; });
  let finish!: (value: unknown) => void; const pending = new Promise(resolve => { finish = resolve; });
  mocks.invoke.mockImplementation(() => { start(); return pending; });
  const moving = moveLocalResourceRoot(selected, "request-1"); await started;
  selected.resourceRoot = "W:/next-selection"; selected.planFingerprint = "b".repeat(64);
  finish(result); await expect(moving).resolves.toEqual(result);
});
