import { useState } from "react";

import {
  commandError,
  restoreSubtitleVersion,
  reviseSubtitleVersion,
} from "../lib/desktop";
import type { Project, SubtitleSegment, SubtitleVersion } from "../types";
import { Dialog } from "./Dialog";

type RevisionMode = "segments" | "replace" | "offset" | "history";
type TrackRole = "original" | "translation";

type SubtitleRevisionDialogProps = {
  project: Project;
  versions: SubtitleVersion[];
  onClose: () => void;
  onVersionCreated: (
    version: SubtitleVersion,
    message: string,
  ) => Promise<void>;
  onRetranslate: (segmentIds: string[]) => void;
};

const issueOptions = [
  ["none", "没有问题"],
  ["incorrect", "明显错误"],
  ["duplicate", "疑似重复"],
  ["missing", "疑似缺失"],
] as const;

function formatTime(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1_000));
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  return hours > 0
    ? `${hours.toString().padStart(2, "0")}:${minutes
        .toString()
        .padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`
    : `${minutes.toString().padStart(2, "0")}:${seconds
        .toString()
        .padStart(2, "0")}`;
}

function issueLabel(issueKind: SubtitleSegment["issueKind"]): string | null {
  if (issueKind === "incorrect") {
    return "明显错误";
  }
  if (issueKind === "duplicate") {
    return "疑似重复";
  }
  if (issueKind === "missing") {
    return "疑似缺失";
  }
  return null;
}

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

export function SubtitleRevisionDialog({
  project,
  versions,
  onClose,
  onVersionCreated,
  onRetranslate,
}: SubtitleRevisionDialogProps) {
  const currentOriginal =
    versions.find((version) => version.role === "original" && version.isCurrent) ??
    null;
  const currentTranslation =
    versions.find(
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
  const [text, setText] = useState(initialSegment?.text ?? "");
  const [issueKind, setIssueKind] = useState<
    "none" | "missing" | "duplicate" | "incorrect"
  >(initialSegment?.issueKind ?? "none");
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
    ? versions
        .filter(
          (version) =>
            version.trackId === currentVersion.trackId &&
            version.id !== currentVersion.id,
        )
        .sort((left, right) => right.versionNumber - left.versionNumber)
    : [];

  const changeRole = (nextRole: TrackRole) => {
    if (nextRole === "translation" && !currentTranslation) {
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
    setText(nextSegment?.text ?? "");
    setIssueKind(nextSegment?.issueKind ?? "none");
    setSelectedIds(new Set());
    setSearch("");
    setNotice(null);
    setError(null);
  };

  const applyRevision = async (
    segmentEdits: Parameters<typeof reviseSubtitleVersion>[3],
    replacement: Parameters<typeof reviseSubtitleVersion>[4],
    offsetMs: number,
    message: string,
  ) => {
    if (!currentVersion) {
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const version = await reviseSubtitleVersion(
        project.id,
        currentVersion.id,
        project.revision,
        segmentEdits,
        replacement,
        offsetMs,
      );
      await onVersionCreated(version, message);
      onClose();
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

  const restoreHistory = async (restoreVersion: SubtitleVersion) => {
    if (!currentVersion) {
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
        project.revision,
      );
      await onVersionCreated(
        version,
        `已从版本 ${restoreVersion.versionNumber} 创建恢复版本。`,
      );
      onClose();
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
    setActiveSegmentId(segment.id);
    setText(segment.text);
    setIssueKind(segment.issueKind ?? "none");
    setNotice(null);
    setError(null);
  };

  return (
    <Dialog
      title="轻量字幕修正"
      eyebrow="每次保存都创建新版本 · 不进入剪辑时间轴"
      onClose={busy ? () => undefined : onClose}
      actions={
        <button className="button quiet" type="button" onClick={onClose}>
          返回观看
        </button>
      }
    >
      <div className="revision-workspace">
        <div className="revision-track-switch" role="tablist" aria-label="字幕轨">
          <button
            className={role === "original" ? "active" : ""}
            type="button"
            role="tab"
            aria-selected={role === "original"}
            onClick={() => changeRole("original")}
          >
            原文字幕
            <small>
              {currentOriginal
                ? `版本 ${currentOriginal.versionNumber}`
                : "尚未准备"}
            </small>
          </button>
          <button
            className={role === "translation" ? "active" : ""}
            type="button"
            role="tab"
            aria-selected={role === "translation"}
            disabled={!currentTranslation}
            onClick={() => changeRole("translation")}
          >
            简体中文
            <small>
              {currentTranslation
                ? `版本 ${currentTranslation.versionNumber}`
                : "先生成完整翻译"}
            </small>
          </button>
        </div>

        <nav className="revision-mode-tabs" aria-label="修正方式">
          {(
            [
              ["segments", "逐句修正"],
              ["replace", "全局替换"],
              ["offset", "时间偏移"],
              ["history", "历史版本"],
            ] as const
          ).map(([value, label]) => (
            <button
              className={mode === value ? "active" : ""}
              type="button"
              key={value}
              onClick={() => {
                setMode(value);
                setNotice(null);
                setError(null);
              }}
            >
              {label}
            </button>
          ))}
        </nav>

        {!currentVersion ? (
          <div className="translation-empty">
            <span className="translation-empty-mark">字</span>
            <div>
              <h3>当前字幕轨还没有版本</h3>
              <p>先准备原文字幕或生成完整简体中文字幕。</p>
            </div>
          </div>
        ) : mode === "segments" ? (
          <div className="revision-segment-layout">
            <section className="revision-segment-browser">
              <label className="revision-search">
                <span>查找字幕</span>
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="输入台词或序号"
                />
              </label>
              <div className="revision-segment-list">
                {filteredSegments.map((segment) => {
                  const marker = issueLabel(segment.issueKind);
                  return (
                    <div
                      className={
                        segment.id === activeSegmentId ? "active" : ""
                      }
                      key={segment.id}
                    >
                      {role === "original" ? (
                        <input
                          type="checkbox"
                          aria-label={`选择第 ${segment.ordinal} 条字幕重译`}
                          checked={selectedIds.has(segment.id)}
                          onChange={() => toggleSelected(segment.id)}
                        />
                      ) : null}
                      <button
                        type="button"
                        onClick={() => selectSegment(segment)}
                      >
                        <span>
                          {segment.ordinal} · {formatTime(segment.startMs)}
                        </span>
                        <strong>{segment.text}</strong>
                      </button>
                      {marker ? <em>{marker}</em> : null}
                    </div>
                  );
                })}
              </div>
              {role === "original" ? (
                <div className="revision-retranslate-bar">
                  <span>
                    {selectedIds.size > 0
                      ? `已选 ${selectedIds.size} 条`
                      : "勾选需要重新翻译的字幕"}
                  </span>
                  <button
                    className="button agent"
                    type="button"
                    disabled={
                      selectedIds.size === 0 || !currentTranslation || busy
                    }
                    onClick={() => onRetranslate([...selectedIds])}
                  >
                    重新翻译选中字幕
                  </button>
                </div>
              ) : null}
            </section>

            <section className="revision-segment-editor">
              {activeSegment ? (
                <>
                  <div className="revision-editor-heading">
                    <span>第 {activeSegment.ordinal} 条</span>
                    <strong>
                      {formatTime(activeSegment.startMs)}–
                      {formatTime(activeSegment.endMs)}
                    </strong>
                  </div>
                  <label className="field">
                    <span>
                      {role === "original" ? "原文字幕" : "简体中文字幕"}
                    </span>
                    <textarea
                      value={text}
                      onChange={(event) => setText(event.target.value)}
                      rows={6}
                    ></textarea>
                  </label>
                  <label className="field">
                    <span>问题标记</span>
                    <select
                      value={issueKind}
                      onChange={(event) =>
                        setIssueKind(
                          event.target.value as typeof issueKind,
                        )
                      }
                    >
                      {issueOptions.map(([value, label]) => (
                        <option value={value} key={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <p className="revision-boundary-copy">
                    这里只修改文本和问题标记，不拆分、合并或拖动单条时间轴。
                  </p>
                  <button
                    className="button primary revision-primary-action"
                    type="button"
                    disabled={busy}
                    onClick={() => void saveSegment()}
                  >
                    {busy ? "正在保存…" : "保存为新版本"}
                  </button>
                </>
              ) : (
                <p className="revision-empty-copy">选择一条字幕开始修正。</p>
              )}
            </section>
          </div>
        ) : mode === "replace" ? (
          <section className="revision-single-panel">
            <span className="status-pill warning">整条字幕轨</span>
            <h3>统一人名、称谓或专有名词</h3>
            <p>只进行精确文本替换。保存前不会修改当前版本。</p>
            <div className="revision-replace-grid">
              <label className="field">
                <span>查找</span>
                <input
                  value={findText}
                  onChange={(event) => setFindText(event.target.value)}
                  placeholder="例如：金老师"
                />
              </label>
              <span>→</span>
              <label className="field">
                <span>替换为</span>
                <input
                  value={replaceText}
                  onChange={(event) => setReplaceText(event.target.value)}
                  placeholder="例如：金教授"
                />
              </label>
            </div>
            <button
              className="button primary revision-primary-action"
              type="button"
              disabled={busy}
              onClick={() => void replaceAcrossTrack()}
            >
              {busy ? "正在保存…" : "替换并创建新版本"}
            </button>
          </section>
        ) : mode === "offset" ? (
          <section className="revision-single-panel">
            <span className="status-pill warning">整条字幕轨</span>
            <h3>整体提前或延后字幕</h3>
            <p>
              正数表示延后，负数表示提前。不会改变每条字幕之间的相对间隔。
            </p>
            <label className="field revision-offset-field">
              <span>偏移秒数</span>
              <div>
                <input
                  value={offsetSeconds}
                  inputMode="decimal"
                  onChange={(event) => setOffsetSeconds(event.target.value)}
                />
                <em>秒</em>
              </div>
            </label>
            <div className="revision-offset-presets">
              {[-1, -0.5, 0.5, 1].map((value) => (
                <button
                  type="button"
                  key={value}
                  onClick={() => setOffsetSeconds(String(value))}
                >
                  {value > 0 ? "+" : ""}
                  {value} 秒
                </button>
              ))}
            </div>
            <button
              className="button primary revision-primary-action"
              type="button"
              disabled={busy}
              onClick={() => void shiftTrack()}
            >
              {busy ? "正在保存…" : "应用偏移并创建新版本"}
            </button>
          </section>
        ) : (
          <section className="revision-history">
            <div className="revision-history-current">
              <span>当前使用</span>
              <strong>版本 {currentVersion.versionNumber}</strong>
              <small>{currentVersion.sourceLabel}</small>
            </div>
            {history.length > 0 ? (
              <div className="revision-history-list">
                {history.map((version) => (
                  <article key={version.id}>
                    <div>
                      <span>版本 {version.versionNumber}</span>
                      <strong>{version.sourceLabel}</strong>
                      <small>
                        {version.segments.length} 条 ·{" "}
                        {new Date(version.createdAtMs).toLocaleString("zh-CN")}
                      </small>
                    </div>
                    <button
                      className="button quiet"
                      type="button"
                      disabled={busy}
                      onClick={() => void restoreHistory(version)}
                    >
                      恢复为新版本
                    </button>
                  </article>
                ))}
              </div>
            ) : (
              <p className="revision-empty-copy">当前字幕轨还没有历史版本。</p>
            )}
          </section>
        )}

        {notice ? (
          <p className="translation-inline-notice" role="status">
            {notice}
          </p>
        ) : null}
        {error ? (
          <div className="notice danger translation-error" role="alert">
            <strong>字幕修正没有保存</strong>
            <p>{error}</p>
          </div>
        ) : null}
      </div>
    </Dialog>
  );
}
