import type { SubtitleVersion } from "../types";
import { SummaryPreview } from "./SummaryPreview";
import { LearningSpeechPreview } from "./LearningSpeechPreview";
import { AiDispatchPreview } from "./AiDispatchPreview";
import { TranslationPreview } from "./TranslationPreview";

export function renderFeaturePreview(query: URLSearchParams, sourceVersion: SubtitleVersion) {
  if (query.has("translation-confirm")) return <TranslationPreview sourceVersion={sourceVersion} />;
  const dispatchKind = query.get("ai-confirm");
  if (dispatchKind) return <AiDispatchPreview kind={dispatchKind} sourceVersion={sourceVersion} />;
  const summary = query.get("summary");
  if (summary === "progress" || summary === "result" || summary === "confirm") {
    return <SummaryPreview state={summary} sourceVersion={sourceVersion} />;
  }
  if (query.get("learning") === "speech") return <LearningSpeechPreview />;
  return null;
}
