import { SubtitleDeliveryDialog } from "../components/SubtitleDeliveryDialog";
import { subtitleMetadata } from "../lib/subtitleMetadata";
import type { Project, SubtitleVersion } from "../types";
export function BurnPreview({ project, source }: { project: Project; source: SubtitleVersion }) {
  const translation: SubtitleVersion = { ...source, id: "burn-translation", role: "translation", languageCode: "zh-CN" };
  return <SubtitleDeliveryDialog project={project} versions={[source, translation].map(subtitleMetadata)}
    currentSubtitle={source} currentTranslation={translation} onClose={() => undefined} />;
}
