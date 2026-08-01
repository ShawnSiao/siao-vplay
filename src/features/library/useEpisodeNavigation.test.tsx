import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  CollectionDetail,
  EpisodeNeighbors,
  LibraryMediaSummary,
} from "../../types";

const gatewayMocks = vi.hoisted(() => ({
  getCollectionDetail: vi.fn(),
  listCollectionEpisodes: vi.fn(),
  getEpisodeNeighbors: vi.fn(),
}));

vi.mock("../../lib/desktop", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/desktop")>()),
  commandError: (error: unknown) => ({ code: "test_error", message: String(error) }),
}));

vi.mock("./libraryGateway", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./libraryGateway")>()),
  ...gatewayMocks,
}));

import {
  useEpisodeNavigation,
  type EpisodePlaybackContext,
} from "./useEpisodeNavigation";

const detail: CollectionDetail = {
  summary: {
    id: "50000000-0000-4000-8000-000000000001",
    kind: "series",
    title: "Rain",
    rootId: "50000000-0000-4000-8000-000000000002",
    systemKey: null,
    posterPath: null,
    sortMode: "episode",
    autoPlayNext: false,
    lastOpenedAtMs: null,
    createdAtMs: 1,
    updatedAtMs: 1,
    itemCount: 2,
    seasonCount: 1,
    watchedCount: 0,
    totalDurationMs: null,
  },
  seasons: [
    {
      seasonNumber: 1,
      episodeCount: 2,
      watchedCount: 0,
      totalDurationMs: null,
    },
  ],
};

const neighbors: EpisodeNeighbors = {
  previous: null,
  next: {
    projectId: "50000000-0000-4000-8000-000000000004",
    displayTitle: "第二集",
    seasonNumber: 1,
    episodeNumber: 2,
    absoluteOrder: 1,
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  gatewayMocks.getCollectionDetail.mockResolvedValue(detail);
  gatewayMocks.listCollectionEpisodes.mockResolvedValue([] satisfies LibraryMediaSummary[]);
  gatewayMocks.getEpisodeNeighbors.mockResolvedValue(neighbors);
});

describe("useEpisodeNavigation", () => {
  it("loads detail, current season, and stable neighbors together", async () => {
    const context: EpisodePlaybackContext = {
      collectionId: detail.summary.id,
      seasonNumber: 1,
    };
    const { result } = renderHook(() =>
      useEpisodeNavigation(context, "50000000-0000-4000-8000-000000000003"),
    );

    await waitFor(() => expect(result.current.state.loading).toBe(false));
    expect(result.current.state.detail?.summary.title).toBe("Rain");
    expect(result.current.state.neighbors.next?.displayTitle).toBe("第二集");
    expect(gatewayMocks.listCollectionEpisodes).toHaveBeenCalledWith(
      detail.summary.id,
      1,
    );
  });

  it("clears episode state when playback returns to an unclassified video", async () => {
    const context: EpisodePlaybackContext = {
      collectionId: detail.summary.id,
      seasonNumber: 1,
    };
    const { result, rerender } = renderHook(
      ({ nextContext, projectId }) =>
        useEpisodeNavigation(nextContext, projectId),
      {
        initialProps: {
          nextContext: context as EpisodePlaybackContext | null,
          projectId: "50000000-0000-4000-8000-000000000003" as string | null,
        },
      },
    );
    await waitFor(() => expect(result.current.state.detail).not.toBeNull());

    await act(async () => {
      rerender({ nextContext: null, projectId: null });
    });
    expect(result.current.state).toMatchObject({
      detail: null,
      episodes: [],
      neighbors: { previous: null, next: null },
    });
  });
});
