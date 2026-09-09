import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => mocks);
vi.mock("./desktop", () => ({ isDesktopApp: true }));
import { revokeLibraryRoot } from "../features/library/libraryGateway";
const receipt = { rootId: "root", detachedCollectionCount: 1, preservedProjectCount: 5 };
beforeEach(() => { mocks.invoke.mockReset(); });
it.each([{}, { ...receipt, rootId: "other" }, { ...receipt, detachedCollectionCount: -1 },
  { ...receipt, preservedProjectCount: Number.MAX_SAFE_INTEGER + 1 },
])("rejects invalid root revocation results", async value => {
  mocks.invoke.mockResolvedValue(value);
  await expect(revokeLibraryRoot("root")).rejects.toThrow();
});
it("accepts linked and orphaned directory revocation", async () => {
  mocks.invoke.mockResolvedValueOnce(receipt).mockResolvedValueOnce({ ...receipt, detachedCollectionCount: 0 });
  await expect(revokeLibraryRoot("root")).resolves.toEqual(receipt);
  await expect(revokeLibraryRoot("root")).resolves.toMatchObject({ detachedCollectionCount: 0 });
});
