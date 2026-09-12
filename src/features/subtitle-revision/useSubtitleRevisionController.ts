import { subtitleMetadata, type SubtitleVersionMetadata } from "./subtitleMetadata";
import { useMemo, useState } from "react";
import { commandError, restoreSubtitleVersion, reviseSubtitleVersion } from "../../lib/desktop";
import type { Project, SubtitleSegment, SubtitleVersion } from "../../types";
import type { HistoryPagination } from "./useSubtitleHistoryPages";

type RevisionMode = "segments" | "replace" | "offset" | "history";
type TrackRole = "original" | "translation";

export type SubtitleRevisionDialogProps = {
  project: Project;
  versions: SubtitleVersion[];
  historyVersions?: SubtitleVersionMetadata[];
  historyPagination?: HistoryPagination;
  onClose: () => void;
  onVersionCreated: (
    version: SubtitleVersion,
    message: string,
  ) => Promise<void>;
  onRetranslate: (segmentIds: string[]) => void;
};

function segmentNearPlayback(
  version: SubtitleVersion | null,
  positionMs: number,
): SubtitleSegment | null {
  if (!version) {
    return null;
  }
  return (
    version.segments.find(
      (segment) =>
        segment.startMs <= positionMs && segment.endMs >= positionMs,
    ) ??
    version.segments[0] ??
    null
  );
}

export function useSubtitleRevisionController({ project, versions, historyVersions = [], onClose, onVersionCreated }: SubtitleRevisionDialogProps) {
  const [workingVersions, setWorkingVersions] = useState(versions.filter((item) => item.isCurrent));
  const [historyRecords, setHistoryRecords] = useState(() => new Map(versions.map(item => [item.id, subtitleMetadata(item)])));
  const [expectedRevision, setExpectedRevision] = useState(project.revision);
  const currentOriginal =
    workingVersions.find((version) => version.role === "original" && version.isCurrent) ??
    null;
  const currentTranslation =
    workingVersions.find(
      (version) => version.role === "translation" && version.isCurrent,
    ) ?? null;
  const initialRole: TrackRole = currentTranslation
    ? "translation"
    : "original";
  const initialVersion =
    initialRole === "translation" ? currentTranslation : currentOriginal;
  const initialSegment = segmentNearPlayback(
    initialVersion,
    project.playbackState.positionMs,
  );
  const [role, setRole] = useState<TrackRole>(initialRole);
  const [mode, setMode] = useState<RevisionMode>("segments");
  const [activeSegmentId, setActiveSegmentId] = useState<string | null>(
    initialSegment?.id ?? null,
  );
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  type Edit = { text: string; issueKind: "none" | "missing" | "duplicate" | "incorrect" };
  const [drafts, setDrafts] = useState<Record<string, Edit>>({});
  const [findText, setFindText] = useState("");
  const [replaceText, setReplaceText] = useState("");
  const [offsetSeconds, setOffsetSeconds] = useState("0.0");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const currentVersion =
    role === "original" ? currentOriginal : currentTranslation;
  const activeSegment =
    currentVersion?.segments.find(
      (segment) => segment.id === activeSegmentId,
    ) ?? null;
  const draftKey = activeSegment ? `${role}:${activeSegment.lineageId}` : "";
  const text = drafts[draftKey]?.text ?? activeSegment?.text ?? "";
  const issueKind = drafts[draftKey]?.issueKind ?? activeSegment?.issueKind ?? "none";
  const setText = (value: string) => setDrafts((current) => ({ ...current, [draftKey]: { text: value, issueKind } }));
  const setIssueKind = (value: Edit["issueKind"]) => setDrafts((current) => ({ ...current, [draftKey]: { text, issueKind: value } }));
  const currentSegments = useMemo(() => new Map<string, SubtitleSegment>(workingVersions.filter((v) => v.isCurrent)
    .flatMap((v) => v.segments.map((s) => [`${v.role}:${s.lineageId}`, s] as const))), [workingVersions]);
  const dirtyKeys = Object.entries(drafts).filter(([key, edit]) => {
    const source = currentSegments.get(key);
    return !source || edit.text !== source.text || edit.issueKind !== (source.issueKind ?? "none");
  }).map(([key]) => key);
  const dirty = dirtyKeys.length > 0 || Boolean(findText || replaceText || (offsetSeconds && Number(offsetSeconds) !== 0));
  const requestClose = () => {
    if (busy) return false;
    if (dirty && !window.confirm("还有未保存的字幕修正。确定放弃并返回观看？选择取消可继续编辑和保存。")) return false;
    onClose();
    return true;
  };
  const query = search.trim().toLocaleLowerCase();
  const filteredSegments = currentVersion
    ? query
      ? currentVersion.segments.filter(
          (segment) =>
            segment.text.toLocaleLowerCase().includes(query) ||
            String(segment.ordinal).includes(query),
        )
      : currentVersion.segments
    : [];
  const history = currentVersion
    ? Array.from(new Map([...historyVersions.map(item => [item.id, item] as const), ...historyRecords]).values())
        .filter(
          (version) =>
            version.trackId === currentVersion.trackId &&
            version.id !== currentVersion.id,
        )
        .sort((left, right) => right.versionNumber - left.versionNumber)
    : [];

  const changeRole = (nextRole: TrackRole) => {
    if (busy || (nextRole === "translation" && !currentTranslation)) {
      return;
    }
    const nextVersion =
      nextRole === "original" ? currentOriginal : currentTranslation;
    const nextSegment = segmentNearPlayback(
      nextVersion,
      project.playbackState.positionMs,
    );
    setRole(nextRole);
    setMode("segments");
    setActiveSegmentId(nextSegment?.id ?? null);
    setSelectedIds(new Set());
    setSearch("");
    setNotice(null);
    setError(null);
  };

  const acceptVersion = async (version: SubtitleVersion, message: string, clearKeys: string[]) => {
    setHistoryRecords((current) => new Map([...current, [version.id, subtitleMetadata(version)]]));
    setWorkingVersions((current) => [version, ...current.filter((item) => item.trackId !== version.trackId)]);
    setExpectedRevision(version.projectRevision);
    const selected = version.segments.find((item) => item.lineageId === activeSegment?.lineageId) ?? version.segments[0];
    setActiveSegmentId(selected?.id ?? null);
    setSelectedIds(new Set());
    setDrafts((current) => Object.fromEntries(Object.entries(current).filter(([key]) => !clearKeys.includes(key))));
    setNotice(`已保存为版本 ${version.versionNumber}，可以继续修正。`);
    try { await onVersionCreated(version, message); }
    catch { setError("字幕已保存，但主界面刷新失败。可以继续修正，或关闭后重新打开视频。"); }
  };

  const applyRevision = async (
    segmentEdits: Parameters<typeof reviseSubtitleVersion>[3],
    replacement: Parameters<typeof reviseSubtitleVersion>[4],
    offsetMs: number,
    message: string,
  ) => {
    if (!currentVersion || busy) {
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const version = await reviseSubtitleVersion(
        project.id,
        currentVersion.id,
        expectedRevision,
        segmentEdits,
        replacement,
        offsetMs,
      );
      const savedKeys = (segmentEdits ?? []).map((edit) => currentVersion.segments.find((item) => item.id === edit.segmentId))
        .filter((item) => item !== undefined).map((item) => `${role}:${item.lineageId}`);
      await acceptVersion(version, message, savedKeys);
      if (replacement) { setFindText(""); setReplaceText(""); }
      if (offsetMs) setOffsetSeconds("0.0");
    } catch (cause) {
      setError(commandError(cause).message);
    } finally {
      setBusy(false);
    }
  };

  const saveSegment = async () => {
    if (!activeSegment) {
      return;
    }
    const nextText = text.trim();
    if (!nextText) {
      setError("字幕文本不能为空。");
      return;
    }
    if (
      nextText === activeSegment.text &&
      issueKind === (activeSegment.issueKind ?? "none")
    ) {
      setError("当前字幕没有需要保存的变化。");
      return;
    }
    await applyRevision(
      [
        {
          segmentId: activeSegment.id,
          text: nextText,
          issueKind,
        },
      ],
      null,
      0,
      `已保存${role === "original" ? "原文" : "中文"}字幕修正。`,
    );
  };

  const replaceAcrossTrack = async () => {
    if (dirtyKeys.some((key) => key.startsWith(`${role}:`))) {
      setError("请先保存当前字幕轨的逐句草稿，再执行全局替换。"); return;
    }
    if (!findText.trim()) {
      setError("请输入要查找的人名、称谓或专有名词。");
      return;
    }
    await applyRevision(
      [],
      { findText: findText.trim(), replaceText },
      0,
      `已完成${role === "original" ? "原文" : "中文"}字幕全局替换。`,
    );
  };

  const shiftTrack = async () => {
    const value = Number(offsetSeconds);
    if (!Number.isFinite(value) || value === 0) {
      setError("请输入不为 0 的有效秒数，例如 0.5 或 -0.8。");
      return;
    }
    const offsetMs = Math.round(value * 1_000);
    await applyRevision(
      [],
      null,
      offsetMs,
      `字幕轨已整体${offsetMs > 0 ? "延后" : "提前"} ${Math.abs(value)} 秒。`,
    );
  };

  const restoreHistory = async (restoreVersion: SubtitleVersionMetadata) => {
    if (!currentVersion || busy) {
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const version = await restoreSubtitleVersion(
        project.id,
        currentVersion.id,
        restoreVersion.id,
        expectedRevision,
      );
      await acceptVersion(
        version,
        `已从版本 ${restoreVersion.versionNumber} 创建恢复版本。`,
        [],
      );
    } catch (cause) {
      setError(commandError(cause).message);
    } finally {
      setBusy(false);
    }
  };

  const toggleSelected = (segmentId: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(segmentId)) {
        next.delete(segmentId);
      } else {
        next.add(segmentId);
      }
      return next;
    });
  };

  const selectSegment = (segment: SubtitleSegment) => {
    if (busy) return;
    setActiveSegmentId(segment.id);
    setNotice(null);
    setError(null);
  };

  return { requestClose, dirty, role, mode, activeSegmentId, selectedIds, search, text, issueKind, findText, replaceText, offsetSeconds, busy, notice, error, currentOriginal, currentTranslation, currentVersion, filteredSegments, history, activeSegment, changeRole, setMode, setSearch, setNotice, setError, toggleSelected, selectSegment, saveSegment, replaceAcrossTrack, shiftTrack, restoreHistory, setText, setIssueKind, setFindText, setReplaceText, setOffsetSeconds };
}
