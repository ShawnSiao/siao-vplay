import { beforeEach, expect, it, vi } from "vitest";
import { importedDetail } from "../features/library/libraryControllerTestFixtures";
import { readCollectionOverview, readRootOverview } from "./libraryOverviewGateway";
const mock = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => mock);
const token = "a".repeat(64);
const input = { offset: 0, expectedSnapshotToken: null };
const cursor = { offset: 0, totalCount: 1, nextOffset: null, snapshotToken: token };
const collection = { ...importedDetail.summary, rootId: null, systemKey: null };
const root = { id: "root", path: "W:\\fixture", displayName: "Folder", availability: "offline", status: "orphaned", itemCount: 0, lastScannedAtMs: null };
const collections = { ...cursor, scope: "collections", rootLinked: false, query: "", items: [collection] };
const roots = { ...cursor, scope: "roots", items: [root] };
beforeEach(() => mock.invoke.mockReset());
it("rejects a page belonging to a different title search", async () => {
  mock.invoke.mockResolvedValue({ ...collections, query: "old" });
  const searched = { ...input, rootLinked: false, query: "new" };
  await expect(readCollectionOverview(searched)).rejects.toThrow();
});
it("preserves literal query and bound snapshot on a search continuation", async () => {
  const searched = { offset: 24, expectedSnapshotToken: token, rootLinked: false, query: "%_\\课程" };
  const page = { ...collections, offset: 24, totalCount: 25, query: searched.query };
  mock.invoke.mockResolvedValue(page);
  await expect(readCollectionOverview(searched)).resolves.toEqual(page);
  expect(mock.invoke).toHaveBeenCalledWith("list_collection_overview", { input: searched });
});
it("accepts an empty search result", async () => {
  const page = { ...collections, query: "missing", totalCount: 0, items: [] };
  mock.invoke.mockResolvedValue(page);
  await expect(readCollectionOverview({ ...input, rootLinked: false, query: "missing" })).resolves.toEqual(page);
});
it("accepts matching collection and root pages", async () => {
  mock.invoke.mockResolvedValueOnce(collections).mockResolvedValueOnce(roots);
  await expect(readCollectionOverview({ ...input, query: "", rootLinked: false })).resolves.toEqual(collections);
  await expect(readRootOverview(input)).resolves.toEqual(roots);
});
it("accepts the folder collection scope with linked roots", async () => {
  const page = { ...collections, rootLinked: true, items: [{ ...collection, rootId: "root" }] };
  mock.invoke.mockResolvedValue(page);
  await expect(readCollectionOverview({ ...input, query: "", rootLinked: true })).resolves.toEqual(page);
});
it.each([
  { ...collections, scope: "roots" }, { ...collections, rootLinked: true },
  { ...collections, offset: 1 }, { ...collections, snapshotToken: "invalid" },
  { ...collections, items: [collection, collection], totalCount: 2 },
  { ...collections, items: [{ ...collection, systemKey: "watch_later" }] },
  { ...collections, items: [{ ...collection, rootId: "unexpected" }] },
  { ...collections, items: [], nextOffset: null },
  { ...collections, nextOffset: 0 }, { ...collections, totalCount: 0 },
  { ...collections, items: Array.from({ length: 25 }, (_, i) => ({ ...collection, id: `c-${i}` })), totalCount: 25 },
])("rejects invalid collection scope, rows or cursor", async value => {
  mock.invoke.mockResolvedValue(value);
  await expect(readCollectionOverview({ ...input, query: "", rootLinked: false })).rejects.toThrow();
});
it.each([
  { ...roots, scope: "collections" }, { ...roots, snapshotToken: "b".repeat(64) },
  { ...roots, items: [root, root], totalCount: 2 }, { ...roots, offset: 1 },
])("rejects wrong root snapshot or page identity", async value => {
  mock.invoke.mockResolvedValue(value);
  await expect(readRootOverview({ ...input, expectedSnapshotToken: token })).rejects.toThrow();
});
it("rejects invalid continuations before invoking native commands", async () => {
  await expect(readRootOverview({ offset: 24, expectedSnapshotToken: null })).rejects.toThrow();
  await expect(readCollectionOverview({ query: "", rootLinked: false, offset: -1, expectedSnapshotToken: token })).rejects.toThrow();
  expect(mock.invoke).not.toHaveBeenCalled();
});
it("accepts the final continuation and sends the bound input unchanged", async () => {
  const continuation = { offset: 24, expectedSnapshotToken: token };
  const page = { ...roots, offset: 24, totalCount: 25 };
  mock.invoke.mockResolvedValue(page);
  await expect(readRootOverview(continuation)).resolves.toEqual(page);
  expect(mock.invoke).toHaveBeenCalledWith("list_root_overview", { input: continuation });
});
