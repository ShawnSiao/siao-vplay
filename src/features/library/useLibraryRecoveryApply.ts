import { useCallback, useRef } from "react";
import { commandError } from "../../lib/commandError";
import type { ApplyLibraryRootRebuildInput, LibraryRescanPreview, LibraryRootRebuildPreview, LibraryRootRelocationPreview, LibraryRescanResult, LibraryRootRebuildResult, LibraryRootRelocationResult } from "../../types";
import type { LibraryImportDraftItem } from "./libraryImportDraft";
import { applyLibraryRescan, applyLibraryRootRebuild, applyLibraryRootRelocation } from "./libraryGateway";

export type RecoveryApplySnapshot = {
  stage:
    | "closed"
    | "inspecting_rescan"
    | "rescan_preview"
    | "inspecting_rebuild"
    | "rebuild_preview"
    | "inspecting_relocation"
    | "relocation_preview"
    | "applying"
    | "error";
  rescanPreview: LibraryRescanPreview | null;
  rebuildPreview: LibraryRootRebuildPreview | null;
  relocationPreview: LibraryRootRelocationPreview | null;
  newItems: LibraryImportDraftItem[];
  rebuildCollectionTitle: string;
  confirmMissing: boolean;
  confirmChanged: boolean;
  confirmUncertainMatches: boolean;
  confirmFingerprintDuplicates: boolean;
};

export type RecoveryApplyEvents = {
  started: () => void;
  rescanCommitted: (result: LibraryRescanResult) => Promise<void>;
  rebuildCommitted: (result: LibraryRootRebuildResult) => Promise<void>;
  relocationCommitted: (result: LibraryRootRelocationResult) => Promise<void>;
  failed: (message: string) => void;
  refreshFailed: (message: string) => void;
};
export function useLibraryRecoveryApply(snapshot: RecoveryApplySnapshot, events: RecoveryApplyEvents) {
  const busy = useRef(false);
  const submit = useCallback(async <T>(run: () => Promise<T>, committed: (result: T) => Promise<void>) => {
    if (busy.current) return null;
    busy.current = true;
    try {
      events.started();
      let result: T;
      try { result = await run(); }
      catch (error) { events.failed(commandError(error).message); return null; }
      try { await committed(result); }
      catch (error) { events.refreshFailed(`恢复操作已完成，但媒体库刷新失败：${commandError(error).message}`); }
      return result;
    } finally { busy.current = false; }
  }, [events]);

  const applyRescan = useCallback(async () => {
    const preview = snapshot.rescanPreview;
    if (!preview || snapshot.stage !== "rescan_preview") {
      return null;
    }
    return submit(() => applyLibraryRescan({
        previewToken: preview.previewToken,
        newItems: snapshot.newItems.map((item) => ({
          candidateId: item.candidateId,
          displayTitle: item.displayTitle,
          seasonNumber: item.seasonNumber,
          episodeNumber: item.episodeNumber,
          absoluteOrder: item.absoluteOrder,
          confirmed: item.confirmed,
        })),
        confirmMissing: snapshot.confirmMissing,
        confirmChanged: snapshot.confirmChanged,
        confirmFingerprintDuplicates: snapshot.confirmFingerprintDuplicates,
      }, preview), events.rescanCommitted);
  }, [snapshot, events, submit]);

  const applyRebuild = useCallback(async () => {
    if (!snapshot.rebuildPreview || snapshot.stage !== "rebuild_preview") {
      return null;
    }
    const input: ApplyLibraryRootRebuildInput = {
      previewToken: snapshot.rebuildPreview.previewToken,
      collectionTitle: snapshot.rebuildCollectionTitle,
      newItems: snapshot.newItems.map((item) => ({
        candidateId: item.candidateId,
        displayTitle: item.displayTitle,
        seasonNumber: item.seasonNumber,
        episodeNumber: item.episodeNumber,
        absoluteOrder: item.absoluteOrder,
        confirmed: item.confirmed,
      })),
      confirmMissing: snapshot.confirmMissing,
      confirmChanged: snapshot.confirmChanged,
      confirmUncertainMatches: snapshot.confirmUncertainMatches,
      confirmFingerprintDuplicates: snapshot.confirmFingerprintDuplicates,
    };
    return submit(() => applyLibraryRootRebuild(input, snapshot.rebuildPreview!), events.rebuildCommitted);
  }, [snapshot, events, submit]);

  const applyRootRelocation = useCallback(async () => {
    if (!snapshot.relocationPreview || snapshot.stage !== "relocation_preview") {
      return null;
    }
    return submit(() => applyLibraryRootRelocation(snapshot.relocationPreview!), events.relocationCommitted);
  }, [snapshot, events, submit]);

  return { applyRescan, applyRebuild, applyRootRelocation };
}
