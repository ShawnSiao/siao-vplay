import { expect, it } from "vitest";
import { applyWatchedProject } from "./applyWatchedProject";
import { emptySectionPages, sectionsFromHome } from "./librarySectionState";
import { importedDetail, libraryHome, mediaSummary } from "./libraryControllerTestFixtures";

it("updates loaded watch-later and episode rows without changing positions or double-counting completion", () => {
  const media = { ...mediaSummary("A"), seasonNumber: 1, positionMs: 5000 };
  const other = { ...mediaSummary("B"), seasonNumber: 1, completedAtMs: 10 };
  const home = { ...libraryHome(2), unclassified: [media, other] };
  const pages = sectionsFromHome(emptySectionPages(), home);
  const state = { home, sectionPages: { ...pages, watch_later: { ...pages.watch_later, initialized: true, items: [media, other] } },
    currentEpisodes: [media, other], currentCollection: { ...importedDetail,
      summary: { ...importedDetail.summary, itemCount: 2, watchedCount: 1 },
      seasons: [{ seasonNumber: 1, episodeCount: 2, watchedCount: 1, totalDurationMs: null }],
    },
  };
  const project = { id: "A", playbackState: { positionMs: 0, durationMs: 10000, completedAtMs: 20 as number | null, volume: 1, playbackRate: 1, subtitleMode: "original" as const, updatedAtMs: 20 } };
  const watched = applyWatchedProject(state, project);
  expect(watched.sectionPages.watch_later.items[0]).toMatchObject({ positionMs: 5000, completedAtMs: 20 });
  expect(watched.currentCollection.summary.watchedCount).toBe(2);
  expect(applyWatchedProject(watched, project).currentCollection.summary.watchedCount).toBe(2);
  const corrected = applyWatchedProject(watched, { ...project, playbackState: { ...project.playbackState, completedAtMs: null } });
  expect(corrected.currentCollection.seasons[0].watchedCount).toBe(1);
  expect(corrected.currentEpisodes[1].completedAtMs).toBe(10);
  expect(corrected.currentEpisodes[0].positionMs).toBe(5000);
});
