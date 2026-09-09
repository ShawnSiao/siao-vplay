import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => mocks);
vi.mock("./desktop", () => ({ isDesktopApp: true }));
import { confirmLibraryImport } from "../features/library/libraryGateway";
import { importedDetail } from "../features/library/libraryControllerTestFixtures";
const input = { previewToken: "token", collectionTitle: "Rain", confirmFingerprintDuplicates: false,
  items: [{ candidateId: "candidate", displayTitle: "Rain", seasonNumber: 1, episodeNumber: 1, absoluteOrder: 0, confirmed: true }] };
const result = { rootId: importedDetail.summary.rootId, collection: importedDetail, importedItemCount: 1, createdProjectCount: 1, reusedProjectCount: 0 };
beforeEach(() => { mocks.invoke.mockReset(); });
it.each([{}, { ...result, rootId: "other" }, { ...result, importedItemCount: 2 },
  { ...result, createdProjectCount: 0 }, { ...result, reusedProjectCount: -1 },
])("rejects invalid import receipts", async value => {
  mocks.invoke.mockResolvedValue(value);
  await expect(confirmLibraryImport(input)).rejects.toThrow();
});
it("accepts successful creation and existing-project reuse", async () => {
  mocks.invoke.mockResolvedValueOnce(result).mockResolvedValueOnce({ ...result, createdProjectCount: 0, reusedProjectCount: 1 });
  await expect(confirmLibraryImport(input)).resolves.toEqual(result);
  await expect(confirmLibraryImport(input)).resolves.toMatchObject({ reusedProjectCount: 1 });
});
