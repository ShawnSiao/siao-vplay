import { expect, it } from "vitest";
import { posterCandidates } from "./posterCandidates";
import { emptySectionPages } from "./librarySectionState";
import { emptyLibraryHome } from "./libraryGateway";
import type { LibraryMediaSummary } from "../../types";
const item = (projectId: string, posterPath: string | null = null) => ({ projectId, posterPath }) as LibraryMediaSummary;
const state = () => ({ home: { ...emptyLibraryHome, recentlyAdded: [item("home")] }, section: "home" as const,
  sectionPages: emptySectionPages(), currentCollection: null, currentEpisodes: [item("hidden")], searchQuery: "" });
it("only considers the loaded active list", () => {
  const value = state(); value.sectionPages.watch_later.items = [item("saved")];
  expect(posterCandidates(value).map((entry) => entry.projectId)).toEqual(["home"]);
  expect(posterCandidates({ ...value, section: "watch_later" }).map((entry) => entry.projectId)).toEqual(["saved"]);
  expect(posterCandidates({ ...value, searchQuery: "query" })).toEqual([]);
});
it("deduplicates home sections and keeps known posters", () => {
  const value = state(); value.home.continueWatching = [item("home", "known.jpg")];
  expect(posterCandidates(value)).toEqual([item("home", "known.jpg")]);
});
