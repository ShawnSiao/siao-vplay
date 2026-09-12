import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => mocks);
vi.mock("./desktop", () => ({ isDesktopApp: true }));
import { inspectLibraryRootRebuild, applyLibraryRootRebuild } from "../features/library/libraryGateway";
import { importedDetail } from "../features/library/libraryControllerTestFixtures";
const rootId = importedDetail.summary.rootId!;
const item = { projectId: "p", candidateId: "candidate", relativePath: "p.mp4", displayTitle: "p", seasonNumber: 1, episodeNumber: 1, absoluteOrder: 0, previousAvailability: "available" as const, matchKind: "matched" as const, reason: null };
const preview = { previewToken: "token", rootId, currentRootPath: "W:\\old", rootPath: "W:\\root", rootDisplayName: "root", suggestedCollectionTitle: "Rain", rootOffline: false, newCandidates: [], matchedItems: [item], missingItems: [], changedItems: [], uncertainItems: [], ignoredCount: 0, expiresAtMs: 1000 };
const input = { previewToken: "token", collectionTitle: "Rain", newItems: [], confirmMissing: false, confirmChanged: false, confirmUncertainMatches: false, confirmFingerprintDuplicates: false };
const receipt = { root: { id: rootId, path: preview.rootPath, displayName: "root", availability: "available", status: "linked", itemCount: 1, lastScannedAtMs: 1 }, collection: importedDetail, restoredItemCount: 1, addedItemCount: 0, createdProjectCount: 0, reusedProjectCount: 1, missingItemCount: 0, changedItemCount: 0 };
beforeEach(() => { mocks.invoke.mockReset(); });
it.each([{}, { ...preview, rootId: "other" }, { ...preview, previewToken: " " }, { ...preview, matchedItems: [item, item] }, { ...preview, missingItems: [item], matchedItems: [] }])("rejects invalid rebuild previews", async value => {
  mocks.invoke.mockResolvedValue(value);
  await expect(inspectLibraryRootRebuild({ rootId, newRootPath: null })).rejects.toThrow();
});
it("refuses a token from a different preview before execution", async () => {
  await expect(applyLibraryRootRebuild({ ...input, previewToken: "other" }, preview)).rejects.toThrow();
  expect(mocks.invoke).not.toHaveBeenCalled();
});
it.each([{}, { ...receipt, root: { ...receipt.root, id: "other" } }, { ...receipt, restoredItemCount: 0 }, { ...receipt, reusedProjectCount: 0 }])("rejects inconsistent rebuild receipts", async value => {
  mocks.invoke.mockResolvedValue(value);
  await expect(applyLibraryRootRebuild(input, preview)).rejects.toThrow();
});
it("accepts a matched preview and restored project receipt", async () => {
  mocks.invoke.mockResolvedValueOnce(preview).mockResolvedValueOnce(receipt);
  await expect(inspectLibraryRootRebuild({ rootId, newRootPath: null })).resolves.toEqual(preview);
  await expect(applyLibraryRootRebuild(input, preview)).resolves.toEqual(receipt);
});
