import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { LibraryRecoveryState } from "../features/library/useLibraryController";
import { LibraryRecoveryDialog } from "./LibraryRecoveryDialog";

const rescanState: LibraryRecoveryState = {
  stage: "rescan_preview",
  rootId: "root",
  rescanPreview: {
    previewToken: "token",
    rootId: "root",
    rootPath: "W:\\Series\\Rain",
    rootDisplayName: "Rain",
    collectionId: "collection",
    rootOffline: false,
    newCandidates: [],
    missingItems: [{
      collectionId: "collection",
      projectId: "missing",
      relativePath: "Rain.S01E01.mp4",
      displayTitle: "第一集",
      previousAvailability: "available",
    }],
    changedItems: [{
      collectionId: "collection",
      projectId: "changed",
      relativePath: "Rain.S01E02.mp4",
      displayTitle: "第二集",
      previousAvailability: "available",
    }],
    availableItemCount: 2,
    ignoredCount: 0,
    expiresAtMs: 1_900_000_000_000,
  },
  relocationPreview: null,
  rebuildPreview: null,
  newItems: [],
  rebuildCollectionTitle: "",
  confirmMissing: false,
  confirmChanged: false,
  confirmUncertainMatches: false,
  confirmFingerprintDuplicates: false,
  error: null,
};

function RescanHarness({ onApply }: { onApply: () => Promise<unknown> }) {
  const [state, setState] = useState(rescanState);
  return (
    <LibraryRecoveryDialog
      state={state}
      onClose={() => undefined}
      onItemChange={() => undefined}
        onConfirmationChange={(field, checked) =>
        setState((current) => ({ ...current, [field]: checked }))
        }
        onRebuildTitleChange={() => undefined}
        onApplyRescan={onApply}
        onApplyRebuild={async () => undefined}
        onApplyRelocation={async () => undefined}
    />
  );
}

describe("LibraryRecoveryDialog", () => {
  it("requires explicit confirmation before marking missing or changed items", () => {
    const onApply = vi.fn().mockResolvedValue(undefined);
    render(<RescanHarness onApply={onApply} />);
    const apply = screen.getByRole("button", { name: "应用扫描结果" });
    expect(
      screen.queryByRole("checkbox", { name: /相同内容指纹/ }),
    ).not.toBeInTheDocument();
    expect(apply).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: /确认将缺失文件/ }));
    expect(apply).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: /确认标记内容已变更/ }));
    expect(apply).toBeEnabled();
    fireEvent.click(apply);
    expect(onApply).toHaveBeenCalledOnce();
  });

  it("blocks relocation when any relative path or fingerprint does not match", () => {
    render(
      <LibraryRecoveryDialog
        state={{
          ...rescanState,
          stage: "relocation_preview",
          rescanPreview: null,
          relocationPreview: {
            previewToken: "relocation",
            rootId: "root",
            currentRootPath: "W:\\Old",
            newRootPath: "W:\\New",
            matchedItemCount: 1,
            mismatches: [{
              projectId: "changed",
              relativePath: "Rain.S01E02.mp4",
              reason: "fingerprint_changed",
            }],
            expiresAtMs: 1_900_000_000_000,
          },
        }}
        onClose={() => undefined}
        onItemChange={() => undefined}
        onConfirmationChange={() => undefined}
        onRebuildTitleChange={() => undefined}
        onApplyRescan={async () => undefined}
        onApplyRebuild={async () => undefined}
        onApplyRelocation={async () => undefined}
      />,
    );
    expect(screen.getByText("内容指纹不一致")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "更新根目录" })).toBeDisabled();
  });

  it("requires explicit confirmation before rebuilding uncertain or changed projects", () => {
    const onApplyRebuild = vi.fn().mockResolvedValue(undefined);
    render(
      <LibraryRecoveryDialog
        state={{
          ...rescanState,
          stage: "rebuild_preview",
          rescanPreview: null,
          rebuildPreview: {
            previewToken: "rebuild",
            rootId: "root",
            currentRootPath: "W:\\Old",
            rootPath: "W:\\New",
            rootDisplayName: "New",
            suggestedCollectionTitle: "New",
            rootOffline: false,
            newCandidates: [],
            matchedItems: [],
            missingItems: [],
            changedItems: [{
              projectId: "changed",
              candidateId: "candidate-changed",
              relativePath: "Rain.S01E01.mp4",
              displayTitle: "第一集",
              seasonNumber: 1,
              episodeNumber: 1,
              absoluteOrder: 0,
              previousAvailability: "available",
              matchKind: "changed",
              reason: "内容变化",
            }],
            uncertainItems: [{
              projectId: "uncertain",
              candidateId: "candidate-uncertain",
              relativePath: "Rain.S01E02.mp4",
              displayTitle: "第二集",
              seasonNumber: 1,
              episodeNumber: 2,
              absoluteOrder: 1,
              previousAvailability: "available",
              matchKind: "needs_confirmation",
              reason: "缺少指纹",
            }],
            ignoredCount: 0,
            expiresAtMs: 1_900_000_000_000,
          },
        }}
        onClose={() => undefined}
        onItemChange={() => undefined}
        onConfirmationChange={() => undefined}
        onRebuildTitleChange={() => undefined}
        onApplyRescan={async () => undefined}
        onApplyRebuild={onApplyRebuild}
        onApplyRelocation={async () => undefined}
      />,
    );
    const apply = screen.getByRole("button", { name: "创建剧集" });
    expect(apply).toBeDisabled();
    expect(screen.getByText("需要人工确认的匹配")).toBeInTheDocument();
  });
});
