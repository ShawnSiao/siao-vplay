import { useEffect, useState } from "react";
import type { Project, SubtitleVersion } from "../types";
import { SubtitleRevisionDialog } from "../components/SubtitleRevisionDialog";
import { SubtitleDeliveryDialog } from "../components/SubtitleDeliveryDialog";
import { SubtitleHistoryLoader } from "../features/subtitle-revision/SubtitleHistoryLoader";
export function SubtitleHistoryPreview({ project, version }: { project: Project; version: SubtitleVersion }) {
  const [open, setOpen] = useState<"revision" | "delivery" | null>(null);
  useEffect(() => {
    (window as unknown as { historyFixture: SubtitleVersion }).historyFixture = version;
  }, [version]);
  return <main><button type="button" onClick={() => setOpen("revision")}>修正字幕</button>
    <button type="button" onClick={() => setOpen("delivery")}>导出字幕</button>
    {open ? <SubtitleHistoryLoader projectId={project.id} onClose={() => setOpen(null)}>{({ currentVersions, history, pagination }) => open === "delivery"
      ? <SubtitleDeliveryDialog project={project} versions={history} historyPagination={pagination}
        currentSubtitle={currentVersions.find(item => item.role === "original") ?? null}
        currentTranslation={currentVersions.find(item => item.role === "translation") ?? null} onClose={() => setOpen(null)} />
      : <SubtitleRevisionDialog project={project} versions={currentVersions} historyVersions={history} historyPagination={pagination} onClose={() => setOpen(null)}
        onVersionCreated={async () => undefined} onRetranslate={() => undefined} />
    }</SubtitleHistoryLoader> : null}
  </main>;
}
