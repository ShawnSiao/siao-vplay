import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => mocks);
vi.mock("./desktop", () => ({ isDesktopApp: true }));
import { inspectLibraryRescan, applyLibraryRescan } from "../features/library/libraryGateway";
import { importedDetail } from "../features/library/libraryControllerTestFixtures";
const rootId = importedDetail.summary.rootId!;
const preview = { previewToken: "token", rootId, rootPath: "W:\\root", rootDisplayName: "root", collectionId: importedDetail.summary.id, rootOffline: false, newCandidates: [], missingItems: [], changedItems: [], availableItemCount: 1, ignoredCount: 0, expiresAtMs: 1000 };
const input = { previewToken: "token", newItems: [], confirmMissing: false, confirmChanged: false, confirmFingerprintDuplicates: false };
const receipt = { root: { id: rootId, path: preview.rootPath, displayName: "root", availability: "available", status: "linked", itemCount: 1, lastScannedAtMs: 1 }, collection: importedDetail, addedItemCount: 0, createdProjectCount: 0, reusedProjectCount: 0, missingItemCount: 0, changedItemCount: 0, availableItemCount: 1 };
beforeEach(() => { mocks.invoke.mockReset(); });
it.each([{}, { ...preview, rootId: "other" }, { ...preview, previewToken: " " },
  { ...preview, missingItems: [{ collectionId: "other", projectId: "p", relativePath: "p.mp4", displayTitle: "p", previousAvailability: "available" }] },
])("rejects invalid rescan previews", async value => {
  mocks.invoke.mockResolvedValue(value);
  await expect(inspectLibraryRescan(rootId)).rejects.toThrow();
});
it.each([{}, { ...receipt, root: { ...receipt.root, id: "other" } }, { ...receipt, addedItemCount: 1 }, { ...receipt, missingItemCount: 2 }])("rejects results unrelated to the confirmed rescan", async value => {
  mocks.invoke.mockResolvedValue(value);
  await expect(applyLibraryRescan(input, preview)).rejects.toThrow();
});
it("accepts a matching preview and result", async () => {
  mocks.invoke.mockResolvedValueOnce(preview).mockResolvedValueOnce(receipt);
  await expect(inspectLibraryRescan(rootId)).resolves.toEqual(preview);
  await expect(applyLibraryRescan(input, preview)).resolves.toEqual(receipt);
});
it("refuses a mismatched confirmation token before execution", async () => {
  await expect(applyLibraryRescan({ ...input, previewToken: "other" }, preview)).rejects.toThrow();
  expect(mocks.invoke).not.toHaveBeenCalled();
});
it("accepts an offline root with no available items", async () => {
  const offline = { ...preview, rootOffline: true, availableItemCount: 0 };
  const value = { ...receipt, root: { ...receipt.root, availability: "offline" }, availableItemCount: 0 };
  mocks.invoke.mockResolvedValue(value);
  await expect(applyLibraryRescan({ ...input, confirmMissing: true }, offline)).resolves.toEqual(value);
});
