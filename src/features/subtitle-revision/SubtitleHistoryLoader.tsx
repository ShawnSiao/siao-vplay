import { useEffect, useState, type ReactNode } from "react";
import { Dialog } from "../../components/Dialog";
import { commandError, listSubtitleVersions, listSubtitleVersionMetadata } from "../../lib/desktop";
import type { SubtitleVersionMetadata } from "./subtitleMetadata";
import type { SubtitleVersion } from "../../types";

type Catalog = { currentVersions: SubtitleVersion[]; history: SubtitleVersionMetadata[] };

type Props = {
  projectId: string;
  onClose: () => void;
  children: (catalog: Catalog) => ReactNode;
};

export function SubtitleHistoryLoader(props: Props) {
  return <HistoryRequest key={props.projectId} {...props} />;
}

function HistoryRequest({ projectId, onClose, children }: Props) {
  const [versions, setVersions] = useState<Catalog | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    void Promise.all([listSubtitleVersions(projectId, false), listSubtitleVersionMetadata(projectId)]).then(([currentVersions, history]) => {
      const current = currentVersions.filter((version) => version.isCurrent);
      const selected = history.filter((version) => version.isCurrent);
      if (selected.length !== current.length || current.some((version) => !selected.some((item) => item.id === version.id && item.segmentCount === version.segments.length))) {
        throw new Error("字幕版本已变化，请重新读取");
      }
      if (active) setVersions({ currentVersions: current, history });
    }).catch((cause: unknown) => {
      if (active) setError(commandError(cause).message);
    });
    return () => { active = false; };
  }, [projectId, attempt]);
  if (versions) return children(versions);
  return <Dialog title="读取字幕版本" onClose={onClose}>
    {error ? <><p role="alert">{error}</p><button className="button quiet" type="button" onClick={() => {
      setError(null); setAttempt((value) => value + 1);
    }}>重新读取</button></> : <p role="status">正在读取可用的字幕版本…</p>}
  </Dialog>;
}
