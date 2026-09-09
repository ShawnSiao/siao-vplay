import { useEffect, useRef, useState } from "react";
import { deleteProject, getPendingProjectCleanup } from "../lib/projectDeletionGateway";
import type { PendingProjectCleanup } from "../generated/pending-project-cleanup";

export function ProjectCleanupNotice({ revision }: { revision: number }) {
  const [pending, setPending] = useState<PendingProjectCleanup | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [readFailed, setReadFailed] = useState(false);
  const generation = useRef(0);
  useEffect(() => {
    const current = ++generation.current;
    void getPendingProjectCleanup().then(value => {
      if (current !== generation.current) return;
      setPending(value); setReadFailed(false); setBusy(false);
    }).catch(() => {
      if (current !== generation.current) return;
      setReadFailed(true); setBusy(false);
    });
    return () => { generation.current += 1; };
  }, [revision, refresh]);
  const retry = async () => {
    if (!pending || busy) return;
    const current = generation.current;
    setBusy(true); setMessage(null);
    try {
      const result = await deleteProject(pending.projectId);
      if (current !== generation.current) return;
      setMessage(result.cleanupPending > 0 ? "仍有文件未清理，请关闭占用文件的程序后重试。" : null);
      setRefresh(value => value + 1);
    } catch {
      if (current !== generation.current) return;
      setMessage("清理未完成，记录已保留，可以稍后重试。"); setBusy(false);
    }
  };
  if (readFailed) return <div className="notice" role="status">暂时无法检查待清理文件。<button className="button quiet" onClick={() => setRefresh(value => value + 1)}>重新检查</button></div>;
  if (!pending) return null;
  return <div className="notice" role="status">
    <span>{message ?? `项目已删除，仍有 ${pending.pendingDirectories} 个目录待清理。源视频不会被删除。`}</span>
    <button className="button quiet" disabled={busy} onClick={() => void retry()}>{busy ? "正在清理…" : "重试清理"}</button>
  </div>;
}
