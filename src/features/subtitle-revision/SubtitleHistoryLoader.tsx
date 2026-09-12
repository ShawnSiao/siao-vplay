import { type ReactNode } from "react";
import { Dialog } from "../../components/Dialog";
import { useSubtitleHistoryPages, type HistoryPagination } from "./useSubtitleHistoryPages";
import type { SubtitleVersionMetadata } from "./subtitleMetadata";
import type { SubtitleVersion } from "../../types";

type Catalog = { currentVersions: SubtitleVersion[]; history: SubtitleVersionMetadata[]; pagination: HistoryPagination };

type Props = {
  projectId: string;
  onClose: () => void;
  children: (catalog: Catalog) => ReactNode;
};

export function SubtitleHistoryLoader(props: Props) {
  return <HistoryRequest key={props.projectId} {...props} />;
}

function HistoryRequest({ projectId, onClose, children }: Props) {
  const { catalog, pagination, error, retry } = useSubtitleHistoryPages(projectId);
  if (catalog && pagination) return children({ currentVersions: catalog.currentVersions,
    history: [...new Map([...catalog.page.currentVersions, ...catalog.page.items].map(item => [item.id, item])).values()], pagination });
  return <Dialog title="读取字幕版本" onClose={onClose}>
    {error ? <><p role="alert">{error}</p><button className="button quiet" type="button" onClick={retry}>重新读取</button></> : <p role="status">正在读取可用的字幕版本…</p>}
  </Dialog>;
}
