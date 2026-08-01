import { useState } from "react";

import {
  chooseRuntimeStorageRoot,
  commandError,
  downloadRuntimeComponent,
  setPreferredModel,
  setRuntimeStorageRoot,
} from "../lib/desktop";
import type { RuntimeCatalog, RuntimeComponent } from "../types";
import { Dialog } from "./Dialog";

type RuntimeSettingsDialogProps = {
  catalog: RuntimeCatalog | null;
  loading: boolean;
  previewMode: boolean;
  onClose: () => void;
  onCatalogChange: (catalog: RuntimeCatalog) => void;
  onError: (message: string) => void;
};

function formatBytes(bytes: number): string {
  if (bytes <= 0) {
    return "随安装包提供";
  }
  if (bytes >= 1024 ** 3) {
    return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  }
  return `${Math.round(bytes / 1024 ** 2)} MB`;
}

function componentStatus(component: RuntimeComponent): string {
  if (component.available) {
    return "已就绪";
  }
  return component.componentKind === "bundled" ? "未找到" : "待下载";
}

function componentTone(component: RuntimeComponent): "ready" | "warning" {
  return component.available ? "ready" : "warning";
}

export function RuntimeSettingsDialog({
  catalog,
  loading,
  previewMode,
  onClose,
  onCatalogChange,
  onError,
}: RuntimeSettingsDialogProps) {
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const applyCatalog = (nextCatalog: RuntimeCatalog) => {
    setError(null);
    onCatalogChange(nextCatalog);
  };

  const chooseStorageRoot = async () => {
    if (previewMode) {
      return;
    }
    setBusyAction("storage");
    try {
      const path = await chooseRuntimeStorageRoot();
      if (!path) {
        return;
      }
      applyCatalog(await setRuntimeStorageRoot(path));
    } catch (cause) {
      const message = commandError(cause).message;
      setError(message);
      onError(message);
    } finally {
      setBusyAction(null);
    }
  };

  const changeModel = async (modelKind: "small" | "base") => {
    if (previewMode || !catalog || catalog.settings.preferredModel === modelKind) {
      return;
    }
    setBusyAction("model");
    try {
      applyCatalog(await setPreferredModel(modelKind));
    } catch (cause) {
      const message = commandError(cause).message;
      setError(message);
      onError(message);
    } finally {
      setBusyAction(null);
    }
  };

  const download = async (component: RuntimeComponent) => {
    if (previewMode || component.componentKind !== "download") {
      return;
    }
    setBusyAction(component.id);
    try {
      applyCatalog(await downloadRuntimeComponent(component.id));
    } catch (cause) {
      const message = commandError(cause).message;
      setError(message);
      onError(message);
    } finally {
      setBusyAction(null);
    }
  };

  const modelComponent = (modelKind: "small" | "base") =>
    catalog?.components.find(
      (component) => component.id === `whisper-${modelKind}`,
    );

  return (
    <Dialog
      title="运行时与模型设置"
      eyebrow="本地组件"
      onClose={onClose}
      actions={
        <button className="button quiet" type="button" onClick={onClose}>
          完成
        </button>
      }
    >
      <div className="runtime-settings-dialog">
        {previewMode ? (
          <div className="notice warning" role="status">
            <strong>当前是浏览器预览</strong>
            <p>桌面应用才会连接本机运行时、选择目录和下载组件。</p>
          </div>
        ) : null}

        {loading && !catalog ? (
          <div className="runtime-settings-loading" role="status">
            <span className="spinner"></span>
            <span>正在读取本地组件状态…</span>
          </div>
        ) : null}

        {catalog ? (
          <>
            <section className="runtime-settings-section">
              <div className="runtime-settings-section-head">
                <div>
                  <h3>存储目录</h3>
                  <p>FFmpeg、识别模型和下载缓存统一保存在选定目录。</p>
                </div>
                <button
                  className="button quiet"
                  type="button"
                  disabled={previewMode || busyAction !== null}
                  onClick={() => void chooseStorageRoot()}
                >
                  {busyAction === "storage" ? "正在保存…" : "选择目录"}
                </button>
              </div>
              <div className="runtime-storage-path" title={catalog.settings.storageRoot ?? undefined}>
                {catalog.settings.storageRoot ?? "尚未选择；可先选择一个非系统盘目录"}
              </div>
            </section>

            <section className="runtime-settings-section">
              <div className="runtime-settings-section-head">
                <div>
                  <h3>默认识别模型</h3>
                  <p>只影响新打开的字幕生成窗口，已完成的字幕版本不会变化。</p>
                </div>
              </div>
              <fieldset className="runtime-model-options">
                <legend className="sr-only">默认识别模型</legend>
                {(["small", "base"] as const).map((modelKind) => {
                  const component = modelComponent(modelKind);
                  return (
                    <label
                      key={modelKind}
                      className={!component?.available ? "unavailable" : ""}
                    >
                      <input
                        type="radio"
                        name="runtime-preferred-model"
                        value={modelKind}
                        checked={catalog.settings.preferredModel === modelKind}
                        disabled={previewMode || busyAction !== null}
                        onChange={() => void changeModel(modelKind)}
                      />
                      <span>
                        <strong>{modelKind === "small" ? "Small · 标准" : "Base · 轻量"}</strong>
                        <small>
                          {component?.available
                            ? formatBytes(component.expectedSizeBytes)
                            : "尚未下载"}
                        </small>
                      </span>
                    </label>
                  );
                })}
              </fieldset>
            </section>

            <section className="runtime-settings-section">
              <div className="runtime-settings-section-head">
                <div>
                  <h3>组件状态</h3>
                  <p>随包组件优先使用；按需组件下载完成后会在使用前再次校验。</p>
                </div>
              </div>
              <div className="runtime-component-list">
                {catalog.components.map((component) => (
                  <article className="runtime-component-card" key={component.id}>
                    <div className="runtime-component-card-head">
                      <div>
                        <strong>{component.title}</strong>
                        <small>
                          {component.componentKind === "bundled"
                            ? "随包提供"
                            : "按需下载"}
                          {component.version ? ` · ${component.version}` : ""}
                        </small>
                      </div>
                      <span className={`status-pill ${componentTone(component)}`}>
                        {componentStatus(component)}
                      </span>
                    </div>
                    <dl className="runtime-component-meta">
                      <div>
                        <dt>体积</dt>
                        <dd>{formatBytes(component.expectedSizeBytes)}</dd>
                      </div>
                      <div>
                        <dt>许可证</dt>
                        <dd>{component.license}</dd>
                      </div>
                      <div>
                        <dt>路径</dt>
                        <dd title={component.installedPath ?? undefined}>
                          {component.installedPath ?? "未安装"}
                        </dd>
                      </div>
                    </dl>
                    {component.expectedSha256 ? (
                      <p className="runtime-component-hash">
                        SHA-256：<code>{component.expectedSha256}</code>
                      </p>
                    ) : null}
                    <p className="runtime-component-source">
                      来源：
                      <a href={component.sourcePage} target="_blank" rel="noreferrer">
                        {component.sourcePage}
                      </a>
                    </p>
                    {component.errorMessage && !component.available ? (
                      <p className="runtime-component-error">{component.errorMessage}</p>
                    ) : null}
                    {component.componentKind === "download" ? (
                      <button
                        className="button quiet runtime-component-action"
                        type="button"
                        disabled={previewMode || busyAction !== null || component.available}
                        onClick={() => void download(component)}
                      >
                        {busyAction === component.id
                          ? "正在下载并校验…"
                          : component.available
                            ? "已安装"
                            : "下载组件"}
                      </button>
                    ) : null}
                  </article>
                ))}
              </div>
            </section>
          </>
        ) : null}

        {error ? (
          <div className="notice danger" role="alert">
            <strong>设置未保存</strong>
            <p>{error}</p>
          </div>
        ) : null}
      </div>
    </Dialog>
  );
}
