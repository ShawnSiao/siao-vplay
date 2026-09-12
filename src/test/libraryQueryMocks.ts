import type { Mock } from "vitest";
import type { LibraryHome } from "../types";
import type { CollectionOverviewInput } from "../generated/collection-overview-input";
import type { OverviewPageInput } from "../generated/overview-page-input";

export function createMockOverviewReaders(getHome: () => Promise<LibraryHome>) {
  return {
    readCollectionOverview: async (input: CollectionOverviewInput) => {
      const all = (await getHome()).collections.filter(item => item.systemKey === null && (item.rootId !== null) === input.rootLinked
        && item.title.toLowerCase().includes(input.query.toLowerCase()));
      return { scope: "collections" as const, rootLinked: input.rootLinked, query: input.query, snapshotToken: "a".repeat(64),
        offset: input.offset, totalCount: all.length, nextOffset: input.offset + 24 < all.length ? input.offset + 24 : null,
        items: all.slice(input.offset, input.offset + 24) };
    },
    readRootOverview: async (input: OverviewPageInput) => {
      const all = (await getHome()).folders;
      return { scope: "roots" as const, snapshotToken: "b".repeat(64), offset: input.offset, totalCount: all.length,
        nextOffset: input.offset + 24 < all.length ? input.offset + 24 : null, items: all.slice(input.offset, input.offset + 24) };
    },
  };
}

export function setupLibraryQueryMocks(mocks: {
  listLibrarySection: Mock; listCollectionEpisodePage: Mock; listCollectionEpisodes: Mock;
}) {
  mocks.listLibrarySection.mockResolvedValue({ items: [], totalCount: 0, nextOffset: null });
  // Reuse each App test's collection fixture without invoking a real full-list query.
  mocks.listCollectionEpisodePage.mockImplementation(async (collectionId, seasonNumber, offset) => {
    const all = await mocks.listCollectionEpisodes(collectionId, seasonNumber);
    const items = all.slice(offset, offset + 24);
    return { items, totalCount: all.length, nextOffset: offset + items.length < all.length ? offset + items.length : null, snapshotToken: "snapshot" };
  });
}
