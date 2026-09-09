import { useCallback, useRef } from "react";
import { commandError } from "../../lib/commandError";
import type { ConfirmLibraryImportInput, LibraryImportResult, LibraryScanPreview } from "../../types";
import { confirmLibraryImport } from "./libraryGateway";
import type { LibraryImportDraftItem } from "./libraryImportDraft";

export type FolderImportSnapshot = {
  stage: "closed" | "scanning" | "preview" | "importing";
  preview: LibraryScanPreview | null;
  collectionTitle: string;
  items: LibraryImportDraftItem[];
  confirmFingerprintDuplicates: boolean;
};
export type FolderImportEvents = {
  started: () => void;
  committed: (result: LibraryImportResult, source: { rootPath: string; rootDisplayName: string }) => Promise<void>;
  failed: (message: string) => void;
  refreshFailed: (message: string) => void;
};

export function useLibraryFolderImport(snapshot: FolderImportSnapshot, events: FolderImportEvents) {
  const busy = useRef(false);
  return useCallback(async () => {
    if (busy.current || !snapshot.preview || snapshot.stage !== "preview") return null;
    const source = { rootPath: snapshot.preview.rootPath, rootDisplayName: snapshot.preview.rootDisplayName };
    const input: ConfirmLibraryImportInput = {
      previewToken: snapshot.preview.previewToken,
      collectionTitle: snapshot.collectionTitle,
      items: snapshot.items.map(item => ({ candidateId: item.candidateId, displayTitle: item.displayTitle,
        seasonNumber: item.seasonNumber, episodeNumber: item.episodeNumber, absoluteOrder: item.absoluteOrder, confirmed: item.confirmed })),
      confirmFingerprintDuplicates: snapshot.confirmFingerprintDuplicates,
    };
    busy.current = true;
    events.started();
    try {
      let result: LibraryImportResult;
      try { result = await confirmLibraryImport(input); }
      catch (error) { events.failed(commandError(error).message); return null; }
      try { await events.committed(result, source); }
      catch (error) { events.refreshFailed(`导入已完成，但媒体库刷新失败：${commandError(error).message}`); }
      return result;
    } finally { busy.current = false; }
  }, [snapshot, events]);
}
