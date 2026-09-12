import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { chooseSubtitleDeliveryDirectory, commandError, exportSubtitles, startSubtitleBurn } from "../../lib/desktop";
import type { SubtitleBurnJob, SubtitleExport, SubtitleExportFormat, SubtitleExportMode } from "../../types";
import { readSubtitleDisplayPreferences } from "../playback/playbackPreferences";

export type DeliveryOperation = "loading" | "selecting" | "exporting" | "starting" | "cancelling" | "resuming" | null;
type Options = {
  projectId: string; outputKind: "subtitle" | "video"; mode: SubtitleExportMode; format: SubtitleExportFormat;
  sourceVersionId: string; translationVersionId: string; canSubmit: boolean;
  onOperation: (value: DeliveryOperation) => void; onError: (value: string | null) => void;
  onExported: (value: SubtitleExport) => void; onJob: (value: SubtitleBurnJob) => void;
};

export function useDeliverySubmission(options: Options) {
  const lifetime = useRef({ active: true, generation: 0, pending: false });
  const [pending, setPending] = useState(false);
  useLayoutEffect(() => {
    const state = lifetime.current;
    state.active = true;
    return () => { state.active = false; state.generation++; state.pending = false; };
  }, [options.projectId]);
  const invalidate = useCallback(() => {
    lifetime.current.generation++;
    lifetime.current.pending = false;
    setPending(false);
  }, []);
  const submit = async () => {
    const state = lifetime.current;
    if (!options.canSubmit || state.pending || !state.active) return;
    const generation = ++state.generation;
    const current = () => state.active && state.generation === generation;
    state.pending = true; setPending(true);
    options.onOperation("selecting"); options.onError(null);
    try {
      const { projectId, outputKind, mode, format, sourceVersionId, translationVersionId } = options;
      const preferences = readSubtitleDisplayPreferences();
      const destination = await chooseSubtitleDeliveryDirectory(outputKind);
      if (!current() || !destination) return;
      if (outputKind === "subtitle") {
        options.onOperation("exporting");
        const result = await exportSubtitles(projectId, mode, format,
          mode !== "translation" ? sourceVersionId : null,
          mode !== "original" ? translationVersionId : null, destination);
        if (current()) options.onExported(result);
      } else if (translationVersionId) {
        options.onOperation("starting");
        const result = await startSubtitleBurn(projectId, mode === "bilingual" ? "bilingual" : "translation",
          mode === "bilingual" ? sourceVersionId : null, translationVersionId, destination,
          { textSize: preferences.textSize, positionY: preferences.position.y });
        if (current()) options.onJob(result);
      }
    } catch (error) {
      if (current()) options.onError(commandError(error).message);
    } finally {
      if (current()) {
        state.pending = false; setPending(false); options.onOperation(null);
      }
    }
  };
  return { submit, pending, invalidate };
}
