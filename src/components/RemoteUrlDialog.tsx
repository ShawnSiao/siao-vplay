import { useState } from "react";

import {
  cancelRemoteMediaImport,
  commandError,
  importRemoteMediaUrl,
  inspectRemoteMediaUrl,
} from "../lib/desktop";
import type { Project, RemoteMediaPreview } from "../types";
import { Dialog } from "./Dialog";

type RemoteUrlDialogProps = {
  previewMode: boolean;
  onClose: () => void;
  onImported: (project: Project) => void;
};

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

export function RemoteUrlDialog({
  previewMode,
  onClose,
  onImported,
}: RemoteUrlDialogProps) {
  const [url, setUrl] = useState("");
  const [preview, setPreview] = useState<RemoteMediaPreview | null>(null);
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
      setError("浏览器预览只展示界面，请在桌面应用中检查和导入媒体 URL。");
      return;
    }
    setChecking(true);
    setPreview(null);
    setError(null);
    try {
      setPreview(await inspectRemoteMediaUrl(candidate));
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
      const project = await importRemoteMediaUrl(
        preview.originalUrl,
        preview.previewToken,
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
      await cancelRemoteMediaImport(operationId);
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
              {importing ? "正在保存本地副本…" : "确认并导入"}
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
        支持公开 HTTPS 媒体直链和点播 M3U8。不会读取浏览器 Cookie、账号内容或会员资源，也不会访问本机和内网地址。
      </p>
      {previewMode ? (
        <div className="notice remote-url-preview-mode">
          <strong>界面预览</strong>
          <p>可以检查输入和错误状态；实际安全预检与下载只在桌面应用运行。</p>
        </div>
      ) : null}
      <label className="remote-url-field">
        <span>媒体 URL</span>
        <input
          autoFocus
          aria-label="媒体 URL"
          type="url"
          inputMode="url"
          placeholder="https://media.example.com/movie.mp4"
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
        <small>只接受 HTTPS；最多 5 次公开地址重定向，单次导入上限 20 GB。</small>
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
            <span>媒体</span>
            <strong>{preview.displayName}</strong>
          </div>
          <dl>
            <div>
              <dt>来源</dt>
              <dd>{displayHost(preview.finalUrl)}</dd>
            </div>
            <div>
              <dt>类型</dt>
              <dd>
                {preview.mediaKind === "hls" ? "HLS 点播清单" : "媒体文件"}
              </dd>
            </div>
            <div>
              <dt>大小</dt>
              <dd>{formatBytes(preview.contentLength)}</dd>
            </div>
          </dl>
          <p>
            确认后会下载受控副本并在本机完成媒体探测；播放器不会直接连接这个远程地址。
          </p>
        </section>
      ) : null}
    </Dialog>
  );
}
