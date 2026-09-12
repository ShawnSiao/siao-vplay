import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => mocks);
vi.mock("./desktop", () => ({ isDesktopApp: true }));
import { listLibrarySection } from "../features/library/libraryGateway";
import { mediaSummary } from "../features/library/libraryControllerTestFixtures";
const item = mediaSummary("project");
const token = "a".repeat(64);
const page = { items: [item], totalCount: 2, nextOffset: 1, section: "unclassified", offset: 0, snapshotToken: token };
beforeEach(() => mocks.invoke.mockReset());
it("rejects a response from a different section or page", async () => {
  mocks.invoke.mockResolvedValue({ ...page, section: "watch_later", offset: 0, snapshotToken: "a".repeat(64) });
  await expect(listLibrarySection("unclassified", 0)).rejects.toThrow();
});
it.each([
  {}, { ...page, nextOffset: 0 }, { ...page, nextOffset: 99 },
  { ...page, items: [] }, { ...page, items: [item, item], nextOffset: null },
  { ...page, totalCount: -1 }, { ...page, totalCount: 0.5 },
  { ...page, items: [{ ...item, projectId: " " }] },
  { ...page, items: Array.from({ length: 25 }, (_, i) => ({ ...item, projectId: `p-${i}` })), totalCount: 25, nextOffset: null },
])("rejects malformed or non-progressing section pages", async value => {
  mocks.invoke.mockResolvedValue(value);
  await expect(listLibrarySection("unclassified", 0)).rejects.toThrow();
});
it("accepts a first page and continuation from the same snapshot", async () => {
  const next = { ...page, offset: 1, items: [{ ...item, projectId: "second" }], nextOffset: null };
  mocks.invoke.mockResolvedValueOnce(page).mockResolvedValueOnce(next);
  await expect(listLibrarySection("unclassified", 0)).resolves.toEqual(page);
  await expect(listLibrarySection("unclassified", 1, token)).resolves.toEqual(next);
});
it.each([
  { ...page, offset: 1 }, { ...page, snapshotToken: "b".repeat(64) },
  { ...page, snapshotToken: "invalid" }, { ...page, snapshotToken: undefined },
])("rejects mismatched page identity or snapshot", async value => {
  mocks.invoke.mockResolvedValue(value);
  await expect(listLibrarySection("unclassified", 0, token)).rejects.toThrow();
});
it("requires a valid snapshot before requesting a continuation", async () => {
  await expect(listLibrarySection("unclassified", 24)).rejects.toThrow();
  await expect(listLibrarySection("unclassified", 24, "invalid")).rejects.toThrow();
  expect(mocks.invoke).not.toHaveBeenCalled();
});
