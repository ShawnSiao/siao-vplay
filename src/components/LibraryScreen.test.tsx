import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type {
  CollectionDetail,
  CollectionSummary,
  LibraryCollectionDeletionResult,
  LibraryHome,
  LibraryMediaSummary,
} from "../types";
import { LibraryScreen } from "./LibraryScreen";

const collection: CollectionSummary = {
  id: "10000000-0000-4000-8000-000000000001",
  kind: "series",
  title: "Rain",
  rootId: "20000000-0000-4000-8000-000000000001",
  systemKey: null,
  posterPath: null,
  sortMode: "episode",
  autoPlayNext: false,
  lastOpenedAtMs: null,
  createdAtMs: 1,
  updatedAtMs: 1,
  itemCount: 1,
  seasonCount: 1,
  watchedCount: 0,
  totalDurationMs: null,
};

const detail: CollectionDetail = { summary: collection, seasons: [] };

const media: LibraryMediaSummary = {
  projectId: "30000000-0000-4000-8000-000000000001",
  projectTitle: "Rain S01E01",
  displayName: "Rain.S01E01.mp4",
  mediaLocator: "W:\\Rain\\Rain.S01E01.mp4",
  mediaAvailable: true,
  posterPath: null,
  positionMs: 0,
  durationMs: 1000,
  completedAtMs: null,
  lastOpenedAtMs: 1,
  createdAtMs: 1,
  originalSubtitleAvailable: false,
  chineseTranslationAvailable: false,
  collectionId: collection.id,
  collectionTitle: collection.title,
  seasonNumber: 1,
  episodeNumber: 1,
  absoluteOrder: 0,
  episodeTitle: "Rain S01E01",
  itemAvailability: null,
};

function home(overrides: Partial<LibraryHome> = {}): LibraryHome {
  return {
    continueWatching: [],
    collections: [collection],
    folders: [],
    unclassified: [],
    recentlyAdded: [media],
    totalProjectCount: 1,
    collectionItemCount: 1,
    unclassifiedCount: 0,
    ...overrides,
  };
}

function renderScreen(
  overrides: Partial<React.ComponentProps<typeof LibraryScreen>> = {},
) {
  const sectionPages = {
    continue_watching: {
      items: [], totalCount: 0, nextOffset: null, initialized: true,
      loading: false, loadingMore: false, error: null,
    },
    watch_later: {
      items: [], totalCount: 0, nextOffset: null, initialized: true,
      loading: false, loadingMore: false, error: null,
    },
    unclassified: {
      items: [], totalCount: 0, nextOffset: null, initialized: true,
      loading: false, loadingMore: false, error: null,
    },
  } satisfies React.ComponentProps<typeof LibraryScreen>["sectionPages"];
  const props: React.ComponentProps<typeof LibraryScreen> = {
      home: home(),
      section: "home",
      sectionPages,
      currentCollection: null,
      currentEpisodes: [],
      selectedSeason: null,
      loading: false,
      collectionLoading: false,
      mutationPending: false,
      error: null,
      previewMode: false,
      onImport: () => undefined,
      onImportFolder: () => undefined,
      onImportUrl: () => undefined,
      onRescanRoot: () => undefined,
      onRelocateRoot: () => undefined,
      onRebuildRoot: () => undefined,
      onRevokeRoot: () => undefined,
      onOpen: () => undefined,
      onRelink: () => undefined,
      onDelete: () => undefined,
      onOpenLocation: () => undefined,
      onSelectSection: () => undefined,
      onLoadMoreSection: () => undefined,
      onReloadSection: () => undefined,
      onOpenCollection: () => undefined,
      onCloseCollection: () => undefined,
      onSelectSeason: () => undefined,
      onCreateCollection: async () => undefined,
      onUpdateCollection: async () => undefined,
      onDeleteCollection: async () => null,
      onAddToCollection: async () => undefined,
      onRemoveFromCollection: async () => undefined,
      onSetWatchLater: async () => undefined,
      ...overrides,
  };
  return render(
    <LibraryScreen {...props} />,
  );
}

describe("LibraryScreen library lifecycle", () => {
  it("starts an empty library with one clear import action and a unified source dialog", () => {
    const onImport = vi.fn();
    const onImportFolder = vi.fn();
    const onImportUrl = vi.fn();
    renderScreen({
      home: home({
        continueWatching: [],
        collections: [],
        folders: [],
        unclassified: [],
        recentlyAdded: [],
        totalProjectCount: 0,
        collectionItemCount: 0,
      }),
      onImport,
      onImportFolder,
      onImportUrl,
    });

    expect(
      screen.getByRole("heading", {
        name: "把海外视频变成可以连续看懂的内容",
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "导入视频" })).toBeEnabled();
    expect(screen.getByText(/不上传本地视频/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "导入视频" }));
    const dialog = screen.getByRole("dialog", { name: "导入视频" });
    expect(dialog).toHaveTextContent("本地视频");
    expect(dialog).toHaveTextContent("剧集文件夹");
    expect(dialog).toHaveTextContent("公开链接");
    expect(dialog).toHaveTextContent("不会绕过登录、付费或 DRM 限制");

    fireEvent.click(screen.getByRole("button", { name: /打开本地视频/ }));
    expect(onImport).toHaveBeenCalledOnce();
    expect(screen.queryByRole("dialog", { name: "导入视频" })).toBeNull();
    expect(onImportFolder).not.toHaveBeenCalled();
    expect(onImportUrl).not.toHaveBeenCalled();
  });

  it("requires confirmation before deleting a collection and explains what is preserved", async () => {
    const onDeleteCollection = vi
      .fn<() => Promise<LibraryCollectionDeletionResult | null>>()
      .mockResolvedValue({
        collectionId: collection.id,
        rootId: collection.rootId,
        preservedProjectCount: 1,
        rootStatus: "orphaned",
      });
    const onSelectSection = vi.fn();
    renderScreen({
      section: "series",
      currentCollection: detail,
      onDeleteCollection,
      onSelectSection,
    });

    fireEvent.click(screen.getByRole("button", { name: "合集管理" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "删除合集" }));
    expect(onDeleteCollection).not.toHaveBeenCalled();
    expect(screen.getByText(/视频文件、播放进度、字幕和学习资料会保留/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "确认删除合集" }));
    await waitFor(() => expect(onDeleteCollection).toHaveBeenCalledWith(collection.id));
    expect(onSelectSection).toHaveBeenCalledWith("folders");
    expect(screen.getByRole("status")).toHaveTextContent("已保留 1 个视频项目");
  });

  it("shows orphaned folders with rebuild and revoke actions only", () => {
    const onRebuildRoot = vi.fn();
    const onRevokeRoot = vi.fn();
    renderScreen({
      section: "folders",
      home: home({
        folders: [{
          id: "20000000-0000-4000-8000-000000000001",
          path: "W:\\Rain",
          displayName: "Rain",
          availability: "available",
          status: "orphaned",
          lastScannedAtMs: 1,
          itemCount: 1,
        }],
      }),
      onRebuildRoot,
      onRevokeRoot,
    });

    expect(screen.getByText("待重建")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重建剧集 Rain" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Rain 的文件夹操作" }));
    expect(screen.getByRole("menuitem", { name: "撤销授权" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "扫描更新 Rain" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "更换位置 Rain" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重建剧集 Rain" }));
    expect(onRebuildRoot).toHaveBeenCalledWith(
      "20000000-0000-4000-8000-000000000001",
      false,
    );
  });

  it("renders recently added independently from unclassified videos", () => {
    renderScreen({ section: "home", home: home({ unclassified: [], unclassifiedCount: 0 }) });
    expect(screen.getByRole("heading", { name: "最近加入" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "未分类" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /打开最近加入的 Rain S01E01/ })).toBeInTheDocument();
  });
});
