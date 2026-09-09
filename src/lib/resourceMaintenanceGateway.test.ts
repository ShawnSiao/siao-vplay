import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
import { planUnusedResourceCleanup, cleanupUnusedResources, removeLocalResource, rollbackLocalResource, planOldResourceVersionCleanup, cleanupOldResourceVersions } from "./desktop";
beforeEach(() => mocks.invoke.mockReset());
const removal = { resourceId: "ffmpeg", removed: true, affectedCapabilityIds: ["play"] };
const rollback = { resourceId: "ffmpeg", previousVersion: "2", activeVersion: "1" };
const oldPlan = { candidates: [{ resourceId: "ffmpeg", version: "0", reclaimableBytes: 12 }], protectedVersions: ["ffmpeg@1"], reclaimableBytes: 12, confirmationRequired: true };
it.each([
  [() => planUnusedResourceCleanup(), { resourceIds: ["a", "a"], reclaimableBytes: 1, confirmationRequired: true }],
  [() => planUnusedResourceCleanup(), { resourceIds: ["a"], reclaimableBytes: 1, confirmationRequired: false }],
  [() => cleanupUnusedResources(), { removedResourceIds: ["a"], reclaimedBytes: -1 }],
  [() => removeLocalResource("ffmpeg", true), { ...removal, resourceId: "other" }],
  [() => removeLocalResource("ffmpeg", true), { ...removal, affectedCapabilityIds: ["play", "play"] }],
  [() => rollbackLocalResource("ffmpeg", "1"), { ...rollback, activeVersion: "2" }],
  [() => rollbackLocalResource("ffmpeg", "1"), { ...rollback, resourceId: "other" }],
  [() => planOldResourceVersionCleanup(), { ...oldPlan, reclaimableBytes: 13 }],
  [() => planOldResourceVersionCleanup(), { ...oldPlan, candidates: [...oldPlan.candidates, ...oldPlan.candidates], reclaimableBytes: 24 }],
  [() => planOldResourceVersionCleanup(), { ...oldPlan, protectedVersions: ["ffmpeg@0"] }],
  [() => cleanupOldResourceVersions(), { removedVersions: ["ffmpeg@0"], reclaimedBytes: Number.MAX_SAFE_INTEGER + 1 }],
  [() => cleanupOldResourceVersions(), { removedVersions: [""], reclaimedBytes: 0 }],
] as const)("rejects invalid maintenance response %#", async (read, value) => {
  mocks.invoke.mockResolvedValue(value); await expect(read()).rejects.toThrow();
});
it.each([
  [() => planUnusedResourceCleanup(), { resourceIds: [], reclaimableBytes: 0, confirmationRequired: true }],
  [() => cleanupUnusedResources(), { removedResourceIds: [], reclaimedBytes: 0 }],
  [() => removeLocalResource("ffmpeg", true), removal],
  [() => rollbackLocalResource("ffmpeg", "1"), rollback],
  [() => planOldResourceVersionCleanup(), oldPlan],
  [() => cleanupOldResourceVersions(), { removedVersions: ["ffmpeg@0"], reclaimedBytes: 12 }],
] as const)("accepts matching maintenance result %#", async (read, value) => {
  mocks.invoke.mockResolvedValue(value); await expect(read()).resolves.toEqual(value);
});

it("preserves the caller's explicit removal confirmation", async () => {
  mocks.invoke.mockResolvedValue({ ...removal, removed: false });
  await removeLocalResource("ffmpeg", false);
  expect(mocks.invoke).toHaveBeenCalledWith("remove_local_resource", { input: { resourceId: "ffmpeg", confirmed: false } });
});
it("keeps the rollback target and explicit confirmation in the request", async () => {
  mocks.invoke.mockResolvedValue(rollback); await rollbackLocalResource("ffmpeg", "1");
  expect(mocks.invoke).toHaveBeenCalledWith("rollback_local_resource", { input: { resourceId: "ffmpeg", version: "1", confirmed: true } });
});
