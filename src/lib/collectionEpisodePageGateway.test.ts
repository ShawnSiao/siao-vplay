import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => mocks);
import { readCollectionEpisodePage } from "./collectionEpisodePageGateway";
import { mediaSummary } from "../features/library/libraryControllerTestFixtures";
const item = { ...mediaSummary("p"), collectionId: "c", seasonNumber: 1 };
const page = { collectionId: "c", seasonNumber: 1, offset: 0, items: [item], totalCount: 2, nextOffset: 1 };
beforeEach(() => { mocks.invoke.mockReset(); });
it.each([{}, { ...page, collectionId: "other" }, { ...page, seasonNumber: 2 }, { ...page, offset: 1 },
  { ...page, nextOffset: 0 }, { ...page, nextOffset: null }, { ...page, totalCount: -1 },
  { ...page, items: [item, item], nextOffset: null }, { ...page, items: [{ ...item, collectionId: "other" }] },
  { ...page, items: [{ ...item, seasonNumber: 2 }] }].map(value => ({ value })))("rejects malformed, unrelated or non-progressing pages", async ({ value }) => {
    mocks.invoke.mockResolvedValue(value);
    await expect(readCollectionEpisodePage("c", 1, 0)).rejects.toThrow();
  });
it("preserves continuation and a now-empty page beyond the total", async () => {
  const empty = { ...page, offset: 24, items: [], totalCount: 0, nextOffset: null };
  mocks.invoke.mockResolvedValueOnce(page).mockResolvedValueOnce(empty);
  await expect(readCollectionEpisodePage("c", 1, 0)).resolves.toEqual(page);
  await expect(readCollectionEpisodePage("c", 1, 24)).resolves.toEqual(empty);
});
it("allows mixed seasons when no filter is requested", async () => {
  const all = { ...page, seasonNumber: null, items: [item, { ...item, projectId: "p2", seasonNumber: null }], nextOffset: null };
  mocks.invoke.mockResolvedValue(all);
  await expect(readCollectionEpisodePage("c", null, 0)).resolves.toEqual(all);
});
it("rejects unsafe offsets before dispatch", async () => {
  for (const offset of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
    await expect(readCollectionEpisodePage("c", 1, offset)).rejects.toThrow();
  }
  expect(mocks.invoke).not.toHaveBeenCalled();
});
it("rejects a backend page exceeding the wire limit", async () => {
  mocks.invoke.mockResolvedValue({ ...page, totalCount: 25, nextOffset: null,
    items: Array.from({ length: 25 }, (_, index) => ({ ...item, projectId: `p${index}` })) });
  await expect(readCollectionEpisodePage("c", 1, 0)).rejects.toThrow();
});
