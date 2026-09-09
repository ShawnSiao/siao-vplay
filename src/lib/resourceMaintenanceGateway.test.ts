import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
import { planUnusedResourceCleanup, cleanupUnusedResources, removeLocalResource, rollbackLocalResource, planOldResourceVersionCleanup, cleanupOldResourceVersions } from "./desktop";
beforeEach(() => mocks.invoke.mockReset());
const removal = { resourceId: "ffmpeg", removed: true, affectedCapabilityIds: ["play"] };
const rollback = { resourceId: "ffmpeg", previousVersion: "2", activeVersion: "1" };
const oldPlan = { planFingerprint: "a".repeat(64), candidates: [{ resourceId: "ffmpeg", version: "0", reclaimableBytes: 12 }], protectedVersions: ["ffmpeg@1"], reclaimableBytes: 12, confirmationRequired: true };
it.each([
  [() => planUnusedResourceCleanup(), { planFingerprint: "a".repeat(64), resourceIds: ["a", "a"], reclaimableBytes: 1, confirmationRequired: true }],
  [() => planUnusedResourceCleanup(), { planFingerprint: "a".repeat(64), resourceIds: ["a"], reclaimableBytes: 1, confirmationRequired: false }],
  [() => cleanupUnusedResources("a".repeat(64)), { removedResourceIds: ["a"], reclaimedBytes: -1 }],
  [() => removeLocalResource("ffmpeg", true), { ...removal, resourceId: "other" }],
  [() => removeLocalResource("ffmpeg", true), { ...removal, affectedCapabilityIds: ["play", "play"] }],
  [() => rollbackLocalResource("ffmpeg", "1"), { ...rollback, activeVersion: "2" }],
  [() => rollbackLocalResource("ffmpeg", "1"), { ...rollback, resourceId: "other" }],
  [() => planOldResourceVersionCleanup(), { ...oldPlan, reclaimableBytes: 13 }],
  [() => planOldResourceVersionCleanup(), { ...oldPlan, candidates: [...oldPlan.candidates, ...oldPlan.candidates], reclaimableBytes: 24 }],
  [() => planOldResourceVersionCleanup(), { ...oldPlan, protectedVersions: ["ffmpeg@0"] }],
  [() => cleanupOldResourceVersions("a".repeat(64)), { removedVersions: ["ffmpeg@0"], reclaimedBytes: Number.MAX_SAFE_INTEGER + 1 }],
  [() => cleanupOldResourceVersions("a".repeat(64)), { removedVersions: [""], reclaimedBytes: 0 }],
] as const)("rejects invalid maintenance response %#", async (read, value) => {
  mocks.invoke.mockResolvedValue(value); await expect(read()).rejects.toThrow();
});
it.each([
  [() => planUnusedResourceCleanup(), { planFingerprint: "a".repeat(64), resourceIds: [], reclaimableBytes: 0, confirmationRequired: true }],
  [() => cleanupUnusedResources("a".repeat(64)), { removedResourceIds: [], reclaimedBytes: 0 }],
  [() => removeLocalResource("ffmpeg", true), removal],
  [() => rollbackLocalResource("ffmpeg", "1"), rollback],
  [() => planOldResourceVersionCleanup(), oldPlan],
  [() => cleanupOldResourceVersions("a".repeat(64)), { removedVersions: ["ffmpeg@0"], reclaimedBytes: 12 }],
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

it.each([cleanupUnusedResources, cleanupOldResourceVersions])("sends the reviewed plan fingerprint", async cleanup => {
  mocks.invoke.mockResolvedValue({ removedResourceIds: [], removedVersions: [], reclaimedBytes: 0 });
  await cleanup("a".repeat(64));
  expect(mocks.invoke.mock.calls[0][1]).toEqual({ input: { confirmed: true, planFingerprint: "a".repeat(64) } });
});
it.each([cleanupUnusedResources, cleanupOldResourceVersions])("rejects missing plan before invoking cleanup", async cleanup => {
  await expect(cleanup("")).rejects.toThrow(); expect(mocks.invoke).not.toHaveBeenCalled();
});
