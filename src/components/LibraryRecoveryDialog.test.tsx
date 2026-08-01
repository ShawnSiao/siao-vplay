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
  newItems: [],
  confirmMissing: false,
  confirmChanged: false,
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
      onApplyRescan={onApply}
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
        onApplyRescan={async () => undefined}
        onApplyRelocation={async () => undefined}
      />,
    );
    expect(screen.getByText("内容指纹不一致")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "更新根目录" })).toBeDisabled();
  });
});
