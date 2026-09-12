import { useState } from "react";
import { TranslationDialog } from "../components/TranslationDialog";
import { listSubtitleVersions } from "../lib/desktop";
import type { SubtitleVersion } from "../types";

export function TranslationPreview({ sourceVersion }: { sourceVersion: SubtitleVersion }) {
  const [versions, setVersions] = useState<SubtitleVersion[]>([]);
  return <TranslationDialog projectId={sourceVersion.projectId} sourceVersion={sourceVersion} translationVersions={versions}
    onClose={() => undefined} onPrepareOriginal={() => undefined}
    onTaskCompleted={async () => { setVersions(await listSubtitleVersions(sourceVersion.projectId)); }} />;
}
