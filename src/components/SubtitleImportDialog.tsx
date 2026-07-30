import { useMemo, useState } from "react";

import {
  chooseSubtitleFile,
  commandError,
  importEmbeddedSubtitle,
  importSubtitleFile,
  inspectEmbeddedSubtitle,
  inspectSubtitleFile,
} from "../lib/desktop";
import type {
  EmbeddedSubtitlePreview,
  SubtitleImportPreview,
  SubtitleStream,
  SubtitleVersion,
} from "../types";
import { Dialog } from "./Dialog";
import { TranscriptionPanel } from "./TranscriptionPanel";

type SubtitleSelection =
  | {
      kind: "file";
      path: string;
      label: string;
    }
  | {
      kind: "embedded";
      stream: SubtitleStream;
    };

type SubtitleImportDialogProps = {
  projectId: string;
  streams: SubtitleStream[];
  currentVersion: SubtitleVersion | null;
  onClose: () => void;
  onImported: (version: SubtitleVersion) => void;
};

const languageOptions = [
  ["en", "英语"],
  ["th", "泰语"],
  ["ja", "日语"],
  ["ko", "韩语"],
  ["other", "其他语言"],
] as const;

function fileName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? "字幕文件";
}

function languageFromEmbeddedTag(value: string | null): string | null {
  const normalized = value?.trim().toLowerCase();
  const aliases: Record<string, string> = {
    en: "en",
    eng: "en",
    ja: "ja",
    jpn: "ja",
    ko: "ko",
    kor: "ko",
    th: "th",
    tha: "th",
  };
  return normalized ? aliases[normalized] ?? normalized : null;
}

function previewStatus(preview: SubtitleImportPreview) {
  if (!preview.canImport) {
    return { className: "danger", label: "需要修正" };
  }
  if (preview.preflight.warningCount > 0) {
    return { className: "warning", label: "可以导入，有提示" };
  }
  return { className: "ready", label: "可以导入" };
}

export function SubtitleImportDialog({
  projectId,
  streams,
  currentVersion,
  onClose,
  onImported,
}: SubtitleImportDialogProps) {
  const [workflow, setWorkflow] = useState<"import" | "transcribe">("import");
  const [selection, setSelection] = useState<SubtitleSelection | null>(null);
  const [language, setLanguage] = useState("");
  const [otherLanguage, setOtherLanguage] = useState("");
  const [preview, setPreview] = useState<
    SubtitleImportPreview | EmbeddedSubtitlePreview | null
  >(null);
  const [operation, setOperation] = useState<"inspect" | "import" | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const resolvedLanguage = useMemo(
    () => (language === "other" ? otherLanguage.trim() : language),
    [language, otherLanguage],
  );
  const textStreams = streams.filter((stream) => stream.kind === "text");
  const unavailableStreams = streams.filter((stream) => stream.kind !== "text");

  const resetPreview = () => {
    setPreview(null);
    setError(null);
  };

  const chooseFile = async () => {
    setError(null);
    try {
      const path = await chooseSubtitleFile();
      if (!path) {
        return;
      }
      setSelection({ kind: "file", path, label: fileName(path) });
      setPreview(null);
    } catch (cause) {
      setError(commandError(cause).message);
    }
  };

  const chooseEmbedded = (stream: SubtitleStream) => {
    setSelection({ kind: "embedded", stream });
    const detectedLanguage = languageFromEmbeddedTag(stream.language);
    if (detectedLanguage) {
      const isCommon = languageOptions.some(
        ([value]) => value !== "other" && value === detectedLanguage,
      );
      setLanguage(isCommon ? detectedLanguage : "other");
      setOtherLanguage(isCommon ? "" : detectedLanguage);
    } else {
      setLanguage("");
      setOtherLanguage("");
    }
    resetPreview();
  };

  const inspectSelection = async () => {
    if (!selection || !resolvedLanguage) {
      setError("请选择字幕来源和原文语言。");
      return;
    }
    setOperation("inspect");
    setError(null);
    setPreview(null);
    try {
      const nextPreview =
        selection.kind === "file"
          ? await inspectSubtitleFile(
              projectId,
              selection.path,
              resolvedLanguage,
            )
          : await inspectEmbeddedSubtitle(
              projectId,
              selection.stream.index,
              resolvedLanguage,
            );
      setPreview(nextPreview);
    } catch (cause) {
      setError(commandError(cause).message);
    } finally {
      setOperation(null);
    }
  };

  const confirmImport = async () => {
    if (!selection || !preview || !preview.canImport) {
      return;
    }
    setOperation("import");
    setError(null);
    try {
      const version =
        selection.kind === "file"
          ? await importSubtitleFile(
              projectId,
              selection.path,
              resolvedLanguage,
              preview,
            )
          : await importEmbeddedSubtitle(
              projectId,
              selection.stream.index,
              resolvedLanguage,
              preview,
            );
      onImported(version);
      onClose();
    } catch (cause) {
      setError(commandError(cause).message);
    } finally {
      setOperation(null);
    }
  };

  const status = preview ? previewStatus(preview) : null;
  const busy = operation !== null;

  return (
    <Dialog
      title="准备原文字幕"
      eyebrow="导入已有字幕，或从视频原声生成"
      onClose={workflow === "import" && busy ? () => undefined : onClose}
      actions={
        workflow === "transcribe" ? (
          <button className="button quiet" type="button" onClick={onClose}>
            关闭
          </button>
        ) : (
          <>
            <button
              className="button quiet"
              type="button"
              disabled={busy}
              onClick={onClose}
            >
              取消
            </button>
            {preview ? (
              <>
                <button
                  className="button"
                  type="button"
                  disabled={busy}
                  onClick={resetPreview}
                >
                  重新检查
                </button>
                <button
                  className="button primary"
                  type="button"
                  disabled={busy || !preview.canImport}
                  onClick={() => void confirmImport()}
                >
                  {operation === "import" ? "正在导入…" : "导入原文字幕"}
                </button>
              </>
            ) : (
              <button
                className="button primary"
                type="button"
                disabled={busy || !selection || !resolvedLanguage}
                onClick={() => void inspectSelection()}
              >
                {operation === "inspect" ? "正在检查…" : "检查字幕"}
              </button>
            )}
          </>
        )
      }
    >
      <div
        className="subtitle-workflow-switch"
        role="tablist"
        aria-label="字幕准备方式"
      >
        <button
          className={workflow === "import" ? "active" : ""}
          type="button"
          role="tab"
          aria-selected={workflow === "import"}
          disabled={busy}
          onClick={() => setWorkflow("import")}
        >
          导入字幕
        </button>
        <button
          className={workflow === "transcribe" ? "active" : ""}
          type="button"
          role="tab"
          aria-selected={workflow === "transcribe"}
          disabled={busy}
          onClick={() => {
            setWorkflow("transcribe");
            resetPreview();
          }}
        >
          从视频生成
        </button>
      </div>

      {currentVersion ? (
        <div className="subtitle-current-note">
          <span>当前原文字幕</span>
          <strong>{currentVersion.sourceLabel}</strong>
          <small>
            {currentVersion.languageCode.toUpperCase()} ·{" "}
            {currentVersion.segments.length} 条 · 版本{" "}
            {currentVersion.versionNumber} ·{" "}
            {currentVersion.status === "draft" ? "草稿" : "已检查"}
          </small>
          {workflow === "transcribe" ? (
            <div className="subtitle-current-samples">
              {currentVersion.segments.slice(0, 3).map((segment) => (
                <p key={segment.id}>{segment.text}</p>
              ))}
            </div>
          ) : null}
        </div>
      ) : workflow === "import" ? (
        <p className="dialog-copy">
          可以导入 UTF-8 SRT、WebVTT，或读取视频中的文本字幕轨。确认导入前会检查时间轴和媒体范围。
        </p>
      ) : null}

      {workflow === "import" ? (
        <>
          {!preview ? (
            <>
              <section className="subtitle-dialog-section">
                <h3>字幕来源</h3>
                <div className="subtitle-source-list">
                  <button
                    className={`subtitle-source-option ${
                      selection?.kind === "file" ? "selected" : ""
                    }`}
                    type="button"
                    disabled={busy}
                    onClick={() => void chooseFile()}
                  >
                    <span>
                      <strong>选择字幕文件</strong>
                      <small>UTF-8 SRT 或 WebVTT</small>
                    </span>
                    <em>
                      {selection?.kind === "file" ? selection.label : "选择…"}
                    </em>
                  </button>

                  {textStreams.map((stream) => (
                    <button
                      className={`subtitle-source-option ${
                        selection?.kind === "embedded" &&
                        selection.stream.index === stream.index
                          ? "selected"
                          : ""
                      }`}
                      key={stream.index}
                      type="button"
                      disabled={busy}
                      onClick={() => chooseEmbedded(stream)}
                    >
                      <span>
                        <strong>内嵌字幕轨 {stream.index}</strong>
                        <small>
                          {stream.language?.toUpperCase() ?? "语言未知"} ·{" "}
                          {stream.codecName.toUpperCase()}
                        </small>
                      </span>
                      <em>使用</em>
                    </button>
                  ))}
                </div>
                {streams.length === 0 ? (
                  <p className="subtitle-empty-note">
                    这段视频没有检测到内嵌字幕，可以选择本地字幕文件。
                  </p>
                ) : null}
                {unavailableStreams.length > 0 ? (
                  <p className="subtitle-empty-note">
                    检测到 {unavailableStreams.length} 条图片或未知格式字幕轨，MVP
                    暂不支持提取。
                  </p>
                ) : null}
              </section>

              <section className="subtitle-dialog-section">
                <label className="subtitle-language-field">
                  <span>原文语言</span>
                  <select
                    value={language}
                    disabled={busy}
                    onChange={(event) => {
                      setLanguage(event.target.value);
                      setPreview(null);
                      setError(null);
                    }}
                  >
                    <option value="">选择语言</option>
                    {languageOptions.map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                {language === "other" ? (
                  <label className="subtitle-language-field">
                    <span>语言代码</span>
                    <input
                      value={otherLanguage}
                      placeholder="例如 fr、es、de"
                      disabled={busy}
                      onChange={(event) => {
                        setOtherLanguage(event.target.value);
                        setPreview(null);
                        setError(null);
                      }}
                    />
                    <small>
                      其他语言可以导入原文字幕并在后续翻译为简体中文。
                    </small>
                  </label>
                ) : null}
              </section>
            </>
          ) : (
            <section className="subtitle-preview" aria-live="polite">
              <div className="subtitle-preview-head">
                <div>
                  <span>预检结果</span>
                  <strong>{preview.sourceLabel}</strong>
                </div>
                <span className={`status-pill ${status?.className}`}>
                  {status?.label}
                </span>
              </div>
              <div className="subtitle-preview-stats">
                <div>
                  <small>字幕段</small>
                  <strong>{preview.preflight.segmentCount}</strong>
                </div>
                <div>
                  <small>错误</small>
                  <strong>{preview.preflight.errorCount}</strong>
                </div>
                <div>
                  <small>提示</small>
                  <strong>{preview.preflight.warningCount}</strong>
                </div>
              </div>
              {preview.preflight.issues.length > 0 ? (
                <ul className="subtitle-issue-list">
                  {preview.preflight.issues.slice(0, 6).map((issue, index) => (
                    <li
                      className={issue.severity}
                      key={`${issue.code}-${issue.ordinal ?? "track"}-${index}`}
                    >
                      <strong>
                        {issue.severity === "error" ? "错误" : "提示"}
                      </strong>
                      <span>{issue.message}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="subtitle-ready-note">
                  时间轴和媒体范围检查通过，可以导入。
                </p>
              )}
              <div className="subtitle-samples">
                {preview.cues.slice(0, 3).map((cue) => (
                  <p key={cue.ordinal}>{cue.text}</p>
                ))}
              </div>
            </section>
          )}

          {error ? (
            <div className="notice danger subtitle-error" role="alert">
              <strong>字幕处理失败</strong>
              <p>{error}</p>
            </div>
          ) : null}
        </>
      ) : (
        <TranscriptionPanel
          projectId={projectId}
          currentVersion={currentVersion}
          onVersionReady={onImported}
        />
      )}
    </Dialog>
  );
}
