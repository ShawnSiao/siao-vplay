import type { Mock } from "vitest";

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
