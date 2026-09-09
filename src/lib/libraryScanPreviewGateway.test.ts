import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => mocks);
vi.mock("./desktop", () => ({ isDesktopApp: true }));
import { scanLibraryFolder } from "../features/library/libraryGateway";
import { scanPreview as preview } from "../features/library/libraryControllerTestFixtures";
beforeEach(() => { mocks.invoke.mockReset(); });
const input = { scanId: preview.scanId, rootPath: preview.rootPath };
it.each([{}, { ...preview, scanId: "other" }, { ...preview, previewToken: " " },
  { ...preview, candidates: [preview.candidates[0], preview.candidates[0]] },
  { ...preview, needsConfirmationCount: 1 },
  { ...preview, candidates: [{ ...preview.candidates[0], sourceSizeBytes: -1 }] },
  { ...preview, ignoredEntries: [{ relativePath: "hidden", reason: "hidden" }], ignoredCount: 0 },
])("rejects invalid scan previews", async value => {
  mocks.invoke.mockResolvedValue(value);
  await expect(scanLibraryFolder(input)).rejects.toThrow();
});
it("accepts an empty scan with a truncated ignored-entry sample", async () => {
  const value = { ...preview, candidates: [], needsConfirmationCount: 0, ignoredCount: 20, ignoredEntries: [] };
  mocks.invoke.mockResolvedValue(value);
  await expect(scanLibraryFolder(input)).resolves.toEqual(value);
});
it("accepts a preview and a canonicalized root path", async () => {
  mocks.invoke.mockResolvedValue(preview);
  await expect(scanLibraryFolder({ ...input, rootPath: `${input.rootPath}\\.` })).resolves.toEqual(preview);
});
