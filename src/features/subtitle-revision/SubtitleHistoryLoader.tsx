import { useEffect, useState, type ReactNode } from "react";
import { Dialog } from "../../components/Dialog";
import { commandError, listSubtitleVersions } from "../../lib/desktop";
import type { SubtitleVersion } from "../../types";

type Props = {
  projectId: string;
  onClose: () => void;
  children: (versions: SubtitleVersion[]) => ReactNode;
};

export function SubtitleHistoryLoader(props: Props) {
  return <HistoryRequest key={props.projectId} {...props} />;
}

function HistoryRequest({ projectId, onClose, children }: Props) {
  const [versions, setVersions] = useState<SubtitleVersion[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    void listSubtitleVersions(projectId, true).then((result) => {
      if (active) setVersions(result);
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
