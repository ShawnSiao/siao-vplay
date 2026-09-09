import { describe, expect, it } from "vitest";

import type { LibraryHome, LibraryMediaSummary } from "../../types";
import {
  emptySectionPages,
  reduceSectionPages,
  removeUnclassifiedProject,
  sectionsFromHome,
} from "./librarySectionState";

const media = {
  projectId: "project",
} as LibraryMediaSummary;

const home = {
  continueWatching: [],
  continueWatchingCount: 0,
  collectionCount: 0, folderCount: 0, watchLaterCount: 0,
  collections: [],
  folders: [],
  unclassified: [media],
  recentlyAdded: [media],
  totalProjectCount: 1,
  collectionItemCount: 0,
  unclassifiedCount: 1,
} satisfies LibraryHome;

describe("librarySectionState", () => {
  it("discards a first-page response when a home refresh supersedes its request", () => {
    const started = reduceSectionPages(emptySectionPages(), { type: "section_page_started", section: "unclassified", append: false, requestId: 1 });
    const refreshed = sectionsFromHome(started, home);
    const next = reduceSectionPages(refreshed, { type: "section_page_loaded", section: "unclassified", append: false,
      items: [{ ...media, projectId: "old" }], totalCount: 1, nextOffset: null, requestId: 1 });
    expect(next.unclassified.items).toEqual([media]);
  });
  it("invalidates a pending page when membership is removed locally", () => {
    const pages = emptySectionPages();
    pages.unclassified = { ...pages.unclassified, items: [media], totalCount: 2, snapshotToken: "old", initialized: true, loadingMore: true };
    const removed = removeUnclassifiedProject(home, pages, media.projectId).pages;
    expect(removed.unclassified.loadingMore).toBe(false);
    const action = { type: "section_page_loaded" as const, section: "unclassified" as const,
      items: [{ ...media, projectId: "stale" }], totalCount: 2, nextOffset: null, append: true, snapshotToken: "old" };
    expect(reduceSectionPages(removed, action).unclassified.items).toEqual([]);
    const generic = reduceSectionPages(pages, { type: "section_page_remove", section: "unclassified", projectId: media.projectId });
    expect(generic.unclassified.loadingMore).toBe(false);
    expect(reduceSectionPages(generic, action).unclassified.items).toEqual([]);
  });
  it("does not append a stale response after a home refresh replaces its snapshot", () => {
    const pages = emptySectionPages();
    pages.unclassified = { ...pages.unclassified, items: [media], snapshotToken: "old", initialized: true };
    const refreshed = sectionsFromHome(pages, home);
    const next = reduceSectionPages(refreshed, { type: "section_page_loaded", section: "unclassified",
      items: [{ ...media, projectId: "stale" }], totalCount: 2, nextOffset: null, append: true, snapshotToken: "old" });
    expect(next.unclassified.items).toEqual([media]);
  });
  it("removes a successful classification from the unclassified page and count", () => {
    const pages = emptySectionPages();
    pages.unclassified = {
      ...pages.unclassified,
      items: [media],
      totalCount: 1,
      initialized: true,
    };

    const next = removeUnclassifiedProject(home, pages, media.projectId);

    expect(next.home.unclassified).toEqual([]);
    expect(next.home.unclassifiedCount).toBe(0);
    expect(next.pages.unclassified.items).toEqual([]);
    expect(next.pages.unclassified.totalCount).toBe(0);
  });

  it("keeps loaded items when an append request fails", () => {
    const pages = emptySectionPages();
    pages.watch_later = {
      ...pages.watch_later,
      items: [media],
      totalCount: 2,
      nextOffset: 1,
      initialized: true,
    };

    const next = reduceSectionPages(pages, {
      type: "section_page_failed",
      section: "watch_later",
      message: "暂时不可用",
    });

    expect(next.watch_later.items).toEqual([media]);
    expect(next.watch_later.error).toBe("暂时不可用");
  });
});
