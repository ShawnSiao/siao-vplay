import { useCallback, useEffect, useRef } from "react";
import { commandError } from "../../lib/commandError";
import type { LibraryScanPreview, LibraryScanProgress } from "../../types";
import { cancelLibraryScan, listenLibraryScanProgress, scanLibraryFolder } from "./libraryGateway";
import { draftItems, type LibraryImportDraftItem } from "./libraryImportDraft";
export type LibraryScanAction =
  | { type: "scan_started"; scanId: string; rootPath: string }
  | { type: "scan_progress"; progress: LibraryScanProgress }
  | { type: "scan_preview"; preview: LibraryScanPreview; items: LibraryImportDraftItem[] }
  | { type: "scan_failed"; message: string }
  | { type: "scan_closed" };
export function useLibraryFolderScan(dispatch: (action: LibraryScanAction) => void) {
  const scanRef = useRef({ sequence: 0, activeId: null as string | null });
  useEffect(() => {
    const scan = scanRef.current;
    let active = true;
    let stopListening: (() => void) | null = null;
    void listenLibraryScanProgress((progress) => {
      if (active && scan.activeId === progress.scanId) {
        dispatch({ type: "scan_progress", progress });
      }
    }).then((unlisten) => {
      if (active) {
        stopListening = unlisten;
      } else {
        unlisten();
      }
    }).catch(() => {
      // Progress events are supplemental; the scan command still returns its
      // authoritative preview when the event channel is unavailable.
    });
    return () => {
      active = false;
      stopListening?.();
      const scanId = scan.activeId;
      scan.sequence++;
      scan.activeId = null;
      if (scanId) void cancelLibraryScan(scanId).catch(() => undefined);
    };
  }, [dispatch]);

  const startFolderScan = useCallback(async (rootPath: string) => {
    const scan = scanRef.current;
    const previousId = scan.activeId;
    if (previousId) void cancelLibraryScan(previousId).catch(() => undefined);
    const sequence = scan.sequence + 1;
    scan.sequence = sequence;
    const scanId = crypto.randomUUID();
    scan.activeId = scanId;
    dispatch({ type: "scan_started", scanId, rootPath });
    try {
      const preview = await scanLibraryFolder({ scanId, rootPath });
      if (scan.sequence === sequence) {
        scan.activeId = null;
        dispatch({ type: "scan_preview", preview, items: draftItems(preview) });
      }
      return preview;
    } catch (error) {
      if (scan.sequence === sequence) {
        scan.activeId = null;
        dispatch({ type: "scan_failed", message: commandError(error).message });
      }
      return null;
    }
  }, [dispatch]);

  const closeFolderImport = useCallback(() => {
    const scan = scanRef.current;
    const scanId = scan.activeId;
    scan.sequence += 1;
    scan.activeId = null;
    dispatch({ type: "scan_closed" });
    if (scanId) {
      void cancelLibraryScan(scanId).catch(() => undefined);
    }
  }, [dispatch]);

  const cancelFolderScan = useCallback(async () => {
    const scan = scanRef.current;
    const scanId = scan.activeId;
    scan.sequence += 1;
    scan.activeId = null;
    dispatch({ type: "scan_closed" });
    if (scanId) {
      try {
        await cancelLibraryScan(scanId);
      } catch {
        // The scan may have completed between the click and the cancel command.
      }
    }
  }, [dispatch]);

  return { startFolderScan, closeFolderImport, cancelFolderScan };
}
