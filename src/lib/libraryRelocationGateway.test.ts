import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => mocks);
vi.mock("./desktop", () => ({ isDesktopApp: true }));
import { inspectLibraryRootRelocation, applyLibraryRootRelocation } from "../features/library/libraryGateway";
const preview = { previewToken: "token", rootId: "root", currentRootPath: "W:\\old", newRootPath: "W:\\new", matchedItemCount: 2, mismatches: [], expiresAtMs: 1000 };
const receipt = { root: { id: "root", path: "W:\\new", displayName: "new", availability: "available", status: "linked", itemCount: 2, lastScannedAtMs: 1 }, updatedItemCount: 2 };
beforeEach(() => { mocks.invoke.mockReset(); });
it.each([{}, { ...preview, rootId: "other" }, { ...preview, previewToken: " " }, { ...preview, matchedItemCount: -1 }])("rejects invalid relocation previews", async value => {
  mocks.invoke.mockResolvedValue(value);
  await expect(inspectLibraryRootRelocation("root", "W:\\new")).rejects.toThrow();
});
it.each([{}, { ...receipt, root: { ...receipt.root, id: "other" } }, { ...receipt, root: { ...receipt.root, path: "W:\\other" } }, { ...receipt, updatedItemCount: 1 }])("rejects receipts inconsistent with confirmed preview", async value => {
  mocks.invoke.mockResolvedValue(value);
  await expect(applyLibraryRootRelocation(preview)).rejects.toThrow();
});
it("accepts canonicalized preview and matching applied result", async () => {
  mocks.invoke.mockResolvedValueOnce(preview).mockResolvedValueOnce(receipt);
  await expect(inspectLibraryRootRelocation("root", "W:\\new\\.")).resolves.toEqual(preview);
  await expect(applyLibraryRootRelocation(preview)).resolves.toEqual(receipt);
});
