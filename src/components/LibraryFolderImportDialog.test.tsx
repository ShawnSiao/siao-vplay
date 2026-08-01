import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type {
  LibraryFolderImportState,
  LibraryImportDraftItem,
} from "../features/library/useLibraryController";
import { LibraryFolderImportDialog } from "./LibraryFolderImportDialog";

const item: LibraryImportDraftItem = {
  candidateId: "30000000-0000-4000-8000-000000000001",
  relativePath: "special.mp4",
  recognition: "unresolved",
  confirmationReason: "没有识别到明确集号",
  initiallyNeedsConfirmation: true,
  originalDisplayTitle: "special",
  originalSeasonNumber: null,
  originalEpisodeNumber: null,
  originalAbsoluteOrder: 0,
  displayTitle: "special",
  seasonNumber: null,
  episodeNumber: null,
  absoluteOrder: 0,
  confirmed: false,
};

const previewState: LibraryFolderImportState = {
  stage: "preview",
  scanId: "30000000-0000-4000-8000-000000000002",
  rootPath: "W:\\Series\\Special",
  progress: null,
  preview: {
    scanId: "30000000-0000-4000-8000-000000000002",
    previewToken: "30000000-0000-4000-8000-000000000003",
    rootPath: "W:\\Series\\Special",
    rootDisplayName: "Special",
    suggestedCollectionTitle: "Special",
    candidates: [],
    ignoredEntries: [],
    ignoredCount: 0,
    needsConfirmationCount: 1,
    expiresAtMs: 1_900_000_000_000,
  },
  collectionTitle: "Special",
  items: [item],
  confirmFingerprintDuplicates: false,
  error: null,
};

function Harness({ onImport }: { onImport: () => Promise<unknown> }) {
  const [state, setState] = useState(previewState);
  return (
    <LibraryFolderImportDialog
      state={state}
      onClose={() => undefined}
      onCancelScan={async () => undefined}
      onTitleChange={(collectionTitle) =>
        setState((current) => ({ ...current, collectionTitle }))
      }
      onItemChange={(candidateId, values) =>
        setState((current) => ({
          ...current,
          items: current.items.map((currentItem) =>
            currentItem.candidateId === candidateId
              ? { ...currentItem, ...values }
              : currentItem,
          ),
        }))
      }
      onConfirmFingerprintDuplicatesChange={(confirmFingerprintDuplicates) =>
        setState((current) => ({ ...current, confirmFingerprintDuplicates }))
      }
      onImport={onImport}
    />
  );
}

describe("LibraryFolderImportDialog", () => {
  it("requires an episode number and explicit confirmation before import", () => {
    const onImport = vi.fn().mockResolvedValue(undefined);
    render(<Harness onImport={onImport} />);
    const importButton = screen.getByRole("button", { name: "导入 1 集" });
    expect(importButton).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent("缺少有效集号");

    fireEvent.change(screen.getByLabelText("special.mp4 集号"), {
      target: { value: "2" },
    });
    expect(importButton).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: "确认 special.mp4" }));
    expect(importButton).toBeEnabled();
    fireEvent.click(importButton);
    expect(onImport).toHaveBeenCalledOnce();
  });

  it("shows live scan counts and supports cancellation", () => {
    const onCancelScan = vi.fn().mockResolvedValue(undefined);
    render(
      <LibraryFolderImportDialog
        state={{
          ...previewState,
          stage: "scanning",
          preview: null,
          items: [],
          progress: {
            scanId: previewState.scanId!,
            phase: "fingerprinting",
            scannedDirectories: 4,
            scannedFiles: 12,
            candidateFiles: 6,
            ignoredEntries: 3,
            currentRelativePath: "Season 1\\Episode 06.mp4",
            message: null,
          },
        }}
        onClose={() => undefined}
        onCancelScan={onCancelScan}
        onTitleChange={() => undefined}
        onItemChange={() => undefined}
        onConfirmFingerprintDuplicatesChange={() => undefined}
        onImport={async () => undefined}
      />,
    );
    expect(screen.getByText("正在核对媒体指纹")).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "取消扫描" }));
    expect(onCancelScan).toHaveBeenCalledOnce();
  });
});
