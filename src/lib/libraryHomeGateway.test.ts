import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => mocks);
vi.mock("./desktop", () => ({ isDesktopApp: true }));
import { getLibraryHome } from "../features/library/libraryGateway";
import { collection, libraryHome, mediaSummary } from "../features/library/libraryControllerTestFixtures";
const empty = { ...libraryHome(0), continueWatchingCount: 0 };
const item = mediaSummary("project");
const summary = { ...collection, itemCount: 1, watchedCount: 0, seasonCount: 0, totalDurationMs: null };
const folder = { id: "root", path: "W:\\media", displayName: "媒体", availability: "offline", status: "linked", lastScannedAtMs: null, itemCount: 0 };
beforeEach(() => mocks.invoke.mockReset());
it.each([
  {}, { ...empty, totalProjectCount: -1 }, { ...empty, continueWatchingCount: undefined },
  { ...empty, unclassified: [item] },
  { ...empty, collectionCount: undefined },
  { ...empty, folderCount: -1 },
  { ...empty, watchLaterCount: 1 },
  { ...empty, collections: [summary] },
  { ...empty, folders: [folder] },
  { ...empty, collectionCount: 5, collections: Array.from({ length: 5 }, (_, index) => ({ ...summary, id: String(index) })) },
  { ...empty, folderCount: 5, folders: Array.from({ length: 5 }, (_, index) => ({ ...folder, id: String(index) })) },
  { ...empty, collectionCount: 1, collections: [{ ...summary, systemKey: "watch_later" }] },
  { ...empty, totalProjectCount: 2, recentlyAdded: [item, item] },
  { ...empty, totalProjectCount: 1, continueWatchingCount: 2 },
  { ...empty, totalProjectCount: Number.MAX_SAFE_INTEGER + 1 },
  { ...empty, totalProjectCount: 1, recentlyAdded: [{ ...item, projectId: " " }] },
  { ...empty, collections: [summary, summary] },
  { ...empty, collections: [{ ...summary, watchedCount: 2 }] },
  { ...empty, collections: [{ ...summary, systemKey: "unknown" }] },
  { ...empty, folders: [folder, folder] },
  { ...empty, folders: [{ ...folder, availability: "unknown" }] },
])("rejects malformed or contradictory library home", async value => {
  mocks.invoke.mockResolvedValue(value);
  await expect(getLibraryHome()).rejects.toThrow();
});
it("accepts shared membership counts and offline roots", async () => {
  const value = { ...empty, totalProjectCount: 1, collectionItemCount: 2, collectionCount: 2, folderCount: 1,
    collections: [summary, { ...summary, id: "second" }], folders: [folder] };
  mocks.invoke.mockResolvedValue(value);
  await expect(getLibraryHome()).resolves.toEqual(value);
});
it("accepts empty and populated home snapshots", async () => {
  const populated = { ...empty, totalProjectCount: 1, unclassifiedCount: 1, unclassified: [item], recentlyAdded: [item] };
  mocks.invoke.mockResolvedValueOnce(empty).mockResolvedValueOnce(populated);
  await expect(getLibraryHome()).resolves.toEqual(empty);
  await expect(getLibraryHome()).resolves.toEqual(populated);
});

it("accepts independent overview totals larger than previews", async () => {
  const value = { ...empty, totalProjectCount: 10, watchLaterCount: 7, collectionCount: 1000, folderCount: 10000, collections: [summary], folders: [folder] };
  mocks.invoke.mockResolvedValue(value);
  await expect(getLibraryHome()).resolves.toEqual(value);
});
