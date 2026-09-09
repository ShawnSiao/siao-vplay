import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => mocks);
vi.mock("./desktop", () => ({ isDesktopApp: true }));
import { listLibrarySection } from "../features/library/libraryGateway";
import { mediaSummary } from "../features/library/libraryControllerTestFixtures";
const item = mediaSummary("project");
const page = { items: [item], totalCount: 2, nextOffset: 1 };
beforeEach(() => mocks.invoke.mockReset());
it.each([
  {}, { ...page, nextOffset: 0 }, { ...page, nextOffset: 99 },
  { ...page, items: [] }, { ...page, items: [item, item], nextOffset: null },
  { ...page, totalCount: -1 }, { ...page, totalCount: 0.5 },
  { ...page, items: [{ ...item, projectId: " " }] },
])("rejects malformed or non-progressing section pages", async value => {
  mocks.invoke.mockResolvedValue(value);
  await expect(listLibrarySection("unclassified", 0)).rejects.toThrow();
});
it("accepts normal continuation and an offset beyond a reduced total", async () => {
  mocks.invoke.mockResolvedValueOnce(page).mockResolvedValueOnce({ items: [], totalCount: 0, nextOffset: null });
  await expect(listLibrarySection("unclassified", 0)).resolves.toEqual(page);
  await expect(listLibrarySection("unclassified", 24)).resolves.toEqual({ items: [], totalCount: 0, nextOffset: null });
});
