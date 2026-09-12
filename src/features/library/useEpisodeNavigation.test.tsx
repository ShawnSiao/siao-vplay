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
  listCollectionEpisodePage: vi.fn(),
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
  gatewayMocks.listCollectionEpisodePage.mockResolvedValue({ items: [], totalCount: 0, nextOffset: null, snapshotToken: "snapshot" });
  gatewayMocks.getEpisodeNeighbors.mockResolvedValue(neighbors);
});

describe("useEpisodeNavigation", () => {
  it("uses a bounded page instead of the full season in the drawer", async () => {
    const context = { collectionId: detail.summary.id, seasonNumber: 1 };
    const { result } = renderHook(() => useEpisodeNavigation(context, "project", true));
    await waitFor(() => expect(result.current.state.loading).toBe(false));
    expect(gatewayMocks.listCollectionEpisodePage).toHaveBeenCalledWith(detail.summary.id, 1, 0, undefined);
    expect(gatewayMocks.listCollectionEpisodes).not.toHaveBeenCalled();
  });
  it("loads on demand and ignores a list completed after closing the drawer", async () => {
    const context = { collectionId: detail.summary.id, seasonNumber: 1 };
    let finish!: (items: LibraryMediaSummary[]) => void;
    gatewayMocks.listCollectionEpisodePage.mockReturnValueOnce(new Promise(resolve => { finish = items => resolve({ items, totalCount: items.length, nextOffset: null, snapshotToken: "snapshot" }); }));
    const { result, rerender } = renderHook(({ open }) => useEpisodeNavigation(context, "project", open), {
      initialProps: { open: false },
    });
    await waitFor(() => expect(result.current.state.loading).toBe(false));
    expect(gatewayMocks.listCollectionEpisodes).not.toHaveBeenCalled();
    rerender({ open: true });
    await waitFor(() => expect(gatewayMocks.listCollectionEpisodePage).toHaveBeenCalledTimes(1));
    rerender({ open: false });
    await waitFor(() => expect(result.current.state.loading).toBe(false));
    await act(async () => { finish([{ projectId: "late" }] as LibraryMediaSummary[]); });
    expect(result.current.state.episodes).toEqual([]);
    expect(result.current.state.neighbors).toEqual(neighbors);
  });
  it("does not read the whole season during ordinary playback", async () => {
    const context = { collectionId: detail.summary.id, seasonNumber: 1 };
    const { result } = renderHook(() => useEpisodeNavigation(context, "project"));
    await waitFor(() => expect(result.current.state.loading).toBe(false));
    expect(result.current.state.neighbors).toEqual(neighbors);
    expect(gatewayMocks.listCollectionEpisodes).not.toHaveBeenCalled();
  });
  it("ignores a late result from a previous project", async () => {
    const context = { collectionId: detail.summary.id, seasonNumber: 1 };
    let resolve!: (value: EpisodeNeighbors) => void;
    gatewayMocks.getEpisodeNeighbors.mockReturnValueOnce(new Promise(done => { resolve = done; }));
    const { result, rerender } = renderHook(({ projectId }) => useEpisodeNavigation(context, projectId), {
      initialProps: { projectId: "first" },
    });
    gatewayMocks.getEpisodeNeighbors.mockResolvedValueOnce({ previous: null, next: null });
    rerender({ projectId: "second" });
    await waitFor(() => expect(result.current.state.loading).toBe(false));
    await act(async () => { resolve(neighbors); });
    expect(result.current.state.neighbors).toEqual({ previous: null, next: null });
  });
  it("clears previous targets while loading another project and after failure", async () => {
    const context = { collectionId: detail.summary.id, seasonNumber: 1 };
    const { result, rerender } = renderHook(({ projectId }) => useEpisodeNavigation(context, projectId), {
      initialProps: { projectId: "first" },
    });
    await waitFor(() => expect(result.current.state.neighbors.next).not.toBeNull());
    let reject!: (error: Error) => void;
    gatewayMocks.getEpisodeNeighbors.mockReturnValueOnce(new Promise((_, fail) => { reject = fail; }));
    rerender({ projectId: "second" });
    expect(result.current.state).toMatchObject({ loading: true, detail: null, episodes: [], neighbors: { previous: null, next: null } });
    await act(async () => { reject(new Error("offline")); });
    expect(result.current.state).toMatchObject({ loading: false, detail: null, neighbors: { previous: null, next: null } });
    expect(result.current.state.error).toContain("offline");
  });
  it("loads detail, current season, and stable neighbors together", async () => {
    const context: EpisodePlaybackContext = {
      collectionId: detail.summary.id,
      seasonNumber: 1,
    };
    const { result } = renderHook(() =>
      useEpisodeNavigation(context, "50000000-0000-4000-8000-000000000003", true),
    );

    await waitFor(() => expect(result.current.state.loading).toBe(false));
    expect(result.current.state.detail?.summary.title).toBe("Rain");
    expect(result.current.state.neighbors.next?.displayTitle).toBe("第二集");
    expect(gatewayMocks.listCollectionEpisodePage).toHaveBeenCalledWith(
      detail.summary.id,
      1, 0, undefined,
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
