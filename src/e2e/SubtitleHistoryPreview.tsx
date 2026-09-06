import { useEffect, useState } from "react";
import type { Project, SubtitleVersion } from "../types";
import { SubtitleRevisionDialog } from "../components/SubtitleRevisionDialog";
import { SubtitleHistoryLoader } from "../features/subtitle-revision/SubtitleHistoryLoader";
export function SubtitleHistoryPreview({ project, version }: { project: Project; version: SubtitleVersion }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    (window as unknown as { historyFixture: SubtitleVersion }).historyFixture = version;
  }, [version]);
  return <main><button type="button" onClick={() => setOpen(true)}>修正字幕</button>
    {open ? <SubtitleHistoryLoader projectId={project.id} onClose={() => setOpen(false)}>{({ currentVersions, history }) =>
      <SubtitleRevisionDialog project={project} versions={currentVersions} historyVersions={history} onClose={() => setOpen(false)}
        onVersionCreated={async () => undefined} onRetranslate={() => undefined} />
    }</SubtitleHistoryLoader> : null}
  </main>;
}
