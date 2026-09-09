import { useCallback, useEffect, useRef } from "react";
import { commandError } from "../../lib/commandError";
import type { LibraryRescanPreview, LibraryRootRebuildPreview, LibraryRootRelocationPreview } from "../../types";
import { inspectLibraryRescan, inspectLibraryRootRebuild, inspectLibraryRootRelocation } from "./libraryGateway";
import { draftCandidateItems, type LibraryImportDraftItem } from "./libraryImportDraft";

export type LibraryRecoveryPreviewAction = {
      type: "recovery_started";
      stage: "inspecting_rescan" | "inspecting_rebuild" | "inspecting_relocation";
      rootId: string;
    }
  | {
      type: "rescan_preview";
      preview: LibraryRescanPreview;
      items: LibraryImportDraftItem[];
    }
  | {
      type: "rebuild_preview";
      preview: LibraryRootRebuildPreview;
      items: LibraryImportDraftItem[];
    }
  | { type: "relocation_preview"; preview: LibraryRootRelocationPreview }
  | { type: "recovery_failed"; message: string }
  | { type: "recovery_closed" };

export function useLibraryRecoveryPreview(dispatch: (action: LibraryRecoveryPreviewAction) => void) {
  const request = useRef({ sequence: 0 });
  useEffect(() => {
    const lifetime = request.current;
    return () => { lifetime.sequence += 1; };
  }, []);
  const inspectRootRescan = useCallback(async (rootId: string) => {
    const sequence = request.current.sequence + 1;
    request.current.sequence = sequence;
    dispatch({ type: "recovery_started", stage: "inspecting_rescan", rootId });
    try {
      const preview = await inspectLibraryRescan(rootId);
      if (request.current.sequence === sequence) {
        dispatch({
          type: "rescan_preview",
          preview,
          items: draftCandidateItems(preview.newCandidates),
        });
      }
      return preview;
    } catch (error) {
      if (request.current.sequence === sequence) {
        dispatch({ type: "recovery_failed", message: commandError(error).message });
      }
      return null;
    }
  }, [dispatch]);

  const inspectRootRebuild = useCallback(
    async (rootId: string, newRootPath: string | null = null) => {
      const sequence = request.current.sequence + 1;
      request.current.sequence = sequence;
      dispatch({ type: "recovery_started", stage: "inspecting_rebuild", rootId });
      try {
        const preview = await inspectLibraryRootRebuild({ rootId, newRootPath });
        if (request.current.sequence === sequence) {
          dispatch({
            type: "rebuild_preview",
            preview,
            items: draftCandidateItems(preview.newCandidates),
          });
        }
        return preview;
      } catch (error) {
        if (request.current.sequence === sequence) {
          dispatch({ type: "recovery_failed", message: commandError(error).message });
        }
        return null;
      }
    },
    [dispatch],
  );

  const inspectRootRelocation = useCallback(
    async (rootId: string, newRootPath: string) => {
      const sequence = request.current.sequence + 1;
      request.current.sequence = sequence;
      dispatch({ type: "recovery_started", stage: "inspecting_relocation", rootId });
      try {
        const preview = await inspectLibraryRootRelocation(rootId, newRootPath);
        if (request.current.sequence === sequence) {
          dispatch({ type: "relocation_preview", preview });
        }
        return preview;
      } catch (error) {
        if (request.current.sequence === sequence) {
          dispatch({ type: "recovery_failed", message: commandError(error).message });
        }
        return null;
      }
    },
    [dispatch],
  );

  const closeRecovery = useCallback(() => {
    request.current.sequence += 1;
    dispatch({ type: "recovery_closed" });
  }, [dispatch]);

  return { inspectRootRescan, inspectRootRebuild, inspectRootRelocation, closeRecovery };
}
