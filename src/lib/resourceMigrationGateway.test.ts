import { beforeEach, expect, it, vi } from "vitest";
import { adoptLocalResources, inspectLocalResourceMigration, moveLocalResourceRoot, planLocalResourceLocation, planLocalResourceMove } from "./desktop";
const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
beforeEach(() => mocks.invoke.mockReset());
const location = { selectedParent: "W:/new", resourceRoot: "W:/new/SiaoVPlay", parentExists: true,
  resourceRootExists: false, freeSpaceBytes: null, confirmationRequired: true };
const movePlan = { planFingerprint: "a".repeat(64), previousRoot: "W:/old", selectedParent: location.selectedParent, resourceRoot: location.resourceRoot,
  bytesToCopy: 10, fileCount: 1, freeSpaceBytes: null, crossVolume: false, destinationExists: false, confirmationRequired: true };
const moved = { planFingerprint: "a".repeat(64), requestId: "request-1", previousRoot: "W:/old", currentRoot: location.resourceRoot, copiedBytes: 10, verifiedFileCount: 1,
  crossVolume: false, previousRootRetained: true };
const candidate = { sourceKind: "selected_directory", sourceRoot: "W:/source", resourceId: "tool", resourcePath: "W:/source/tool",
  state: "verified", reusableBytes: 10, message: null };
const preview = { planFingerprint: "a".repeat(64), resourceRoot: "W:/target", sources: [{ kind: "selected_directory", path: "W:/source" }], candidates: [candidate],
  verifiedResourceIds: ["tool"], reusableBytes: 10, rejectedCount: 0 };
const adopted = { planFingerprint: "a".repeat(64), resourceRoot: "W:/target", requestId: "request-1", adoptedResourceIds: ["tool"], alreadyActiveResourceIds: [], rejectedResourceIds: [], reusableBytes: 10 };
const operations = {
  location: () => planLocalResourceLocation("W:/new"), plan: () => planLocalResourceMove("W:/new"),
  move: () => moveLocalResourceRoot(movePlan, "request-1"), inspect: () => inspectLocalResourceMigration("W:/source"),
  adopt: () => adoptLocalResources(preview, "request-1"),
};
it.each([
  ["location", null], ["location", { ...location, freeSpaceBytes: undefined }], ["location", { ...location, freeSpaceBytes: -1 }],
  ["location", { ...location, confirmationRequired: false }], ["location", { ...location, selectedParent: "" }],
  ["plan", { ...movePlan, fileCount: 0.5 }], ["plan", { ...movePlan, freeSpaceBytes: undefined }], ["plan", { ...movePlan, bytesToCopy: Number.MAX_SAFE_INTEGER + 1 }],
  ["plan", { ...movePlan, confirmationRequired: false }], ["plan", { ...movePlan, previousRoot: "" }],
  ["move", { ...moved, copiedBytes: -1 }], ["move", { ...moved, previousRootRetained: false }],
  ["move", { ...moved, currentRoot: "" }], ["move", { ...moved, verifiedFileCount: 1.5 }],
  ["inspect", { ...preview, rejectedCount: 1 }], ["inspect", { ...preview, reusableBytes: 11 }],
  ["inspect", { ...preview, verifiedResourceIds: ["other"] }],
  ["inspect", { ...preview, candidates: [{ ...candidate, sourceRoot: "W:/unselected" }] }],
  ["inspect", { ...preview, candidates: [{ ...candidate, state: "unknown" }] }],
  ["inspect", { ...preview, sources: [] }],
  ["inspect", { ...preview, sources: [...preview.sources, { kind: "selected_directory", path: "W:/other" }] }],
  ["inspect", { ...preview, candidates: [{ ...candidate, message: undefined }] }],
  ["adopt", { ...adopted, adoptedResourceIds: ["tool", "tool"] }],
  ["adopt", { ...adopted, alreadyActiveResourceIds: ["tool"] }],
  ["adopt", { ...adopted, reusableBytes: -1 }], ["adopt", { ...adopted, adoptedResourceIds: [], reusableBytes: 10 }],
] as [keyof typeof operations, unknown][])("rejects invalid %s response %#", async (kind, value) => {
  mocks.invoke.mockResolvedValue(value); await expect(operations[kind]()).rejects.toThrow();
});
it.each([["location", location], ["plan", movePlan], ["move", moved], ["inspect", preview], ["adopt", adopted]] as [keyof typeof operations, unknown][])("accepts valid %s response", async (kind, value) => {
  mocks.invoke.mockResolvedValue(value); await expect(operations[kind]()).resolves.toEqual(value);
});
it("accepts duplicate candidate resource IDs and rejected copies of an adopted resource", async () => {
  mocks.invoke.mockResolvedValue({ ...preview, candidates: [candidate, { ...candidate, resourcePath: "W:/source/bad", state: "rejected", reusableBytes: 0 }], rejectedCount: 1 });
  await expect(operations.inspect()).resolves.toHaveProperty("rejectedCount", 1);
  mocks.invoke.mockResolvedValue({ ...adopted, rejectedResourceIds: ["tool"] });
  await expect(operations.adopt()).resolves.toHaveProperty("rejectedResourceIds", ["tool"]);
});

it("preserves exact caller arguments and the move request identity", async () => {
  mocks.invoke.mockResolvedValue(moved); await operations.move();
  expect(mocks.invoke).toHaveBeenLastCalledWith("move_local_resource_root", { input: { parentPath: "W:/new", confirmed: true, planFingerprint: "a".repeat(64) }, requestId: "request-1" });
  mocks.invoke.mockResolvedValue(preview); await operations.inspect();
  expect(mocks.invoke).toHaveBeenLastCalledWith("inspect_local_resource_migration", { input: { sourcePath: "W:/source", sourceKind: "selected_directory" } });
  mocks.invoke.mockResolvedValue({ planFingerprint: "a".repeat(64), resourceRoot: "W:/target", requestId: "request-1", adoptedResourceIds: [], alreadyActiveResourceIds: [], rejectedResourceIds: [], reusableBytes: 0 });
  await adoptLocalResources({ ...preview, sources: [], candidates: [], verifiedResourceIds: [], reusableBytes: 0, rejectedCount: 0 }, "request-1");
  expect(mocks.invoke).toHaveBeenLastCalledWith("adopt_local_resources", { input: { resourceRoot: "W:/target", sourcePath: null, sourceKind: null, confirmed: true, planFingerprint: "a".repeat(64) }, requestId: "request-1" });
});

it("rejects unsolicited migration sources when no directory was selected", async () => {
  mocks.invoke.mockResolvedValue(preview); await expect(inspectLocalResourceMigration()).rejects.toThrow();
});
it("accepts an empty explicit-scope scan and a canonicalized selected directory", async () => {
  mocks.invoke.mockResolvedValue({ planFingerprint: "a".repeat(64), resourceRoot: "W:/target", sources: [], candidates: [], verifiedResourceIds: [], reusableBytes: 0, rejectedCount: 0 });
  await expect(inspectLocalResourceMigration()).resolves.toHaveProperty("sources", []);
  mocks.invoke.mockResolvedValue(preview);
  await expect(inspectLocalResourceMigration("W:/alias-to-source")).resolves.toEqual(preview);
});
