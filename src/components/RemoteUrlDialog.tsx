import { useState } from "react";

import {
  cancelRemoteMediaImport,
  cancelYouTubeImport,
  commandError,
  importRemoteMediaUrl,
  importYouTubeUrl,
  inspectRemoteMediaUrl,
  inspectYouTubeUrl,
} from "../lib/desktop";
import type {
  Project,
  RemoteMediaPreview,
  YouTubeMediaPreview,
} from "../types";
import { Dialog } from "./Dialog";

type RemoteUrlDialogProps = {
  previewMode: boolean;
  onClose: () => void;
  onImported: (project: Project) => void;
};

type UrlImportPreview =
  | { kind: "remote"; value: RemoteMediaPreview }
  | { kind: "youtube"; value: YouTubeMediaPreview };

function formatBytes(bytes: number | null): string {
  if (bytes === null) {
    return "服务器未提供大小";
  }
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value >= 10 || unitIndex === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unitIndex]}`;
}

function displayHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function isYouTubePageUrl(value: string): boolean {
  try {
    const host = new URL(value).hostname.toLowerCase().replace(/\.$/, "");
    return [
      "youtube.com",
      "www.youtube.com",
      "m.youtube.com",
      "youtu.be",
    ].includes(host);
  } catch {
    return false;
  }
}

function formatDuration(seconds: number): string {
  const totalSeconds = Math.max(0, Math.round(seconds));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const remainingSeconds = totalSeconds % 60;
  return hours > 0
    ? `${hours}:${minutes.toString().padStart(2, "0")}:${remainingSeconds
        .toString()
        .padStart(2, "0")}`
    : `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
}

export function RemoteUrlDialog({
  previewMode,
  onClose,
  onImported,
}: RemoteUrlDialogProps) {
  const [url, setUrl] = useState("");
  const [preview, setPreview] = useState<UrlImportPreview | null>(null);
  const [checking, setChecking] = useState(false);
  const [importing, setImporting] = useState(false);
  const [operationId, setOperationId] = useState<string | null>(null);
  const [cancelRequested, setCancelRequested] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const inspect = async () => {
    const candidate = url.trim();
    if (!candidate) {
      setError("请先粘贴公开 HTTPS 媒体地址。");
      return;
    }
    if (previewMode) {
      setError("浏览器预览只展示界面，请在桌面应用中检查和导入视频 URL。");
      return;
    }
    setChecking(true);
    setPreview(null);
    setError(null);
    try {
      if (isYouTubePageUrl(candidate)) {
        setPreview({
          kind: "youtube",
          value: await inspectYouTubeUrl(candidate),
        });
      } else {
        setPreview({
          kind: "remote",
          value: await inspectRemoteMediaUrl(candidate),
        });
      }
    } catch (nextError) {
      setError(commandError(nextError).message);
    } finally {
      setChecking(false);
    }
  };

  const confirmImport = async () => {
    if (!preview) {
      return;
    }
    const nextOperationId = crypto.randomUUID();
    setImporting(true);
    setOperationId(nextOperationId);
    setCancelRequested(false);
    setError(null);
    try {
      const project =
        preview.kind === "youtube"
          ? await importYouTubeUrl(
              preview.value.originalUrl,
              preview.value.previewToken,
              nextOperationId,
            )
          : await importRemoteMediaUrl(
              preview.value.originalUrl,
              preview.value.previewToken,
              nextOperationId,
            );
      onImported(project);
    } catch (nextError) {
      const failure = commandError(nextError);
      setError(failure.message);
      if (failure.code !== "remote_import_cancelled") {
        setPreview(null);
      }
    } finally {
      setImporting(false);
      setOperationId(null);
      setCancelRequested(false);
    }
  };

  const cancelImport = async () => {
    if (!operationId || cancelRequested) {
      return;
    }
    setCancelRequested(true);
    try {
      if (preview?.kind === "youtube") {
        await cancelYouTubeImport(operationId);
      } else {
        await cancelRemoteMediaImport(operationId);
      }
    } catch (nextError) {
      setError(commandError(nextError).message);
      setCancelRequested(false);
    }
  };

  return (
    <Dialog
      title="从 URL 导入视频"
      eyebrow="公开媒体 · 本地副本"
      onClose={importing ? () => undefined : onClose}
      actions={
        <>
          <button
            className="button quiet"
            type="button"
            disabled={checking || cancelRequested}
            onClick={importing ? () => void cancelImport() : onClose}
          >
            {importing
              ? cancelRequested
                ? "正在取消…"
                : "取消导入"
              : "取消"}
          </button>
          {preview ? (
            <button
              className="button primary"
              type="button"
              disabled={importing}
              onClick={() => void confirmImport()}
            >
              {importing ? "正在下载并验证…" : "确认并导入"}
            </button>
          ) : (
            <button
              className="button primary"
              type="button"
              disabled={checking || !url.trim()}
              onClick={() => void inspect()}
            >
              {checking ? "正在安全检查…" : "检查 URL"}
            </button>
          )}
        </>
      }
    >
      <p>
        支持公开 HTTPS 媒体直链、点播 M3U8 和 YouTube 公开单视频。不会读取浏览器 Cookie、账号内容或会员资源，也不会访问本机和内网地址。
      </p>
      {previewMode ? (
        <div className="notice remote-url-preview-mode">
          <strong>界面预览</strong>
          <p>可以检查输入和错误状态；实际安全预检与下载只在桌面应用运行。</p>
        </div>
      ) : null}
      <label className="remote-url-field">
        <span>视频 URL</span>
        <input
          autoFocus
          aria-label="视频 URL"
          type="url"
          inputMode="url"
          placeholder="https://www.youtube.com/watch?v=…"
          value={url}
          disabled={checking || importing}
          onChange={(event) => {
            setUrl(event.target.value);
            setPreview(null);
            setError(null);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !checking && !importing && !preview) {
              event.preventDefault();
              void inspect();
            }
          }}
        />
        <small>
          只接受 HTTPS 和公开单视频；请仅导入有权处理或已获授权的内容，单次上限 20 GB。
        </small>
      </label>

      {error ? (
        <div className="notice danger remote-url-notice" role="alert">
          <strong>无法导入这个地址</strong>
          <p>{error}</p>
        </div>
      ) : null}

      {preview ? (
        <section className="remote-url-preview" aria-label="URL 检查结果">
          <div>
            <span>{preview.kind === "youtube" ? "公开视频" : "媒体"}</span>
            <strong>
              {preview.kind === "youtube"
                ? preview.value.title
                : preview.value.displayName}
            </strong>
          </div>
          <dl>
            <div>
              <dt>来源</dt>
              <dd>
                {displayHost(
                  preview.kind === "youtube"
                    ? preview.value.webpageUrl
                    : preview.value.finalUrl,
                )}
              </dd>
            </div>
            <div>
              <dt>类型</dt>
              <dd>
                {preview.kind === "youtube"
                  ? "公开单视频"
                  : preview.value.mediaKind === "hls"
                    ? "HLS 点播清单"
                    : "媒体文件"}
              </dd>
            </div>
            <div>
              <dt>{preview.kind === "youtube" ? "时长" : "大小"}</dt>
              <dd>
                {preview.kind === "youtube"
                  ? formatDuration(preview.value.durationSeconds)
                  : formatBytes(preview.value.contentLength)}
              </dd>
            </div>
          </dl>
          <p>
            确认后会下载受控副本并在本机完成媒体探测；不会携带登录状态，也不会直接播放远程地址。
          </p>
        </section>
      ) : null}
    </Dialog>
  );
}
