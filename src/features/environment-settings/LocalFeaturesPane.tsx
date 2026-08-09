import { useMemo, useState } from "react";

import type { PendingResourceAction } from "../../components/LocalResourcesDialog";
import type { LocalResourcesController } from "../resources/useLocalResources";
import {
  capabilityDescriptions,
  capabilityStateLabel,
  formatBytes,
  taskStateLabel,
} from "./localResourcePresentation";

type LocalFeaturesPaneProps = {
  controller: LocalResourcesController;
  pendingAction: PendingResourceAction | null;
  previewMode: boolean;
  onNotice: (message: string) => void;
};

export function LocalFeaturesPane({ controller, pendingAction, previewMode, onNotice }: LocalFeaturesPaneProps) {
  const { catalog, status, tasks, networkStatus, loading, error } = controller;
  const [busy, setBusy] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [proxyDraft, setProxyDraft] = useState<string | null>(null);
  const proxyInput = proxyDraft ?? (networkStatus?.proxySource === "custom" ? networkStatus.proxyAddress ?? "" : "");

  const activeTasks = useMemo(
    () => tasks.filter((task) => !["completed", "cancelled"].includes(task.state)),
    [tasks],
  );

  const run = async (label: string, action: () => Promise<unknown>, notice?: string) => {
    setBusy(label);
    setLocalError(null);
    try {
      await action();
      if (notice) onNotice(notice);
    } catch (cause) {
      setLocalError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  };

  const chooseLocation = () => run("location", async () => {
    const plan = await controller.chooseLocation();
    if (plan) await controller.confirmLocation(plan.selectedParent);
  }, "本地功能保存位置已更新。");

  const chooseExisting = () => run("existing", async () => {
    const chosen = await controller.chooseExistingResources();
    if (chosen) await controller.adoptResources(chosen.sourcePath);
  }, "已检查并采用可复用的本地资源。");

  const moveLocation = () => run("move", async () => {
    const plan = await controller.chooseMoveLocation();
    if (plan) await controller.moveLocation(plan.selectedParent);
  }, "本地功能已移动到新位置。");

  const prepare = (capabilityId: string) => run(`prepare:${capabilityId}`, async () => {
    if (!status?.configured) {
      const plan = await controller.chooseLocation();
      if (!plan) return;
      await controller.confirmLocation(plan.selectedParent);
    }
    await controller.prepareCapability(
      capabilityId,
      pendingAction?.capabilityId === capabilityId ? pendingAction.id : undefined,
    );
  });

  const saveProxy = () => run("proxy", async () => {
    await controller.setProxy(proxyInput.trim() || null);
  }, proxyInput.trim() ? "已使用指定代理。" : "已恢复自动网络设置。");

  if (loading && !status) {
    return <section className="environment-local-pane"><div className="environment-loading">正在检查本地功能…</div></section>;
  }

  return (
    <section className="environment-local-pane" aria-label="本地功能">
      <div className="environment-local-scroll">
        <div className="environment-local-heading">
          <div>
            <h2>本地功能</h2>
            <p>只下载需要的内容，并保存到自行选择的位置。</p>
            <small>选择位置不会开始下载；只有准备具体功能时才会下载。</small>
          </div>
          <span className={`environment-status-chip ${status?.configured ? "" : "unavailable"}`}>
            {status?.configured ? "位置已设置" : "等待设置"}
          </span>
        </div>

        {pendingAction ? (
          <div className="environment-pending-action">
            <strong>继续：{pendingAction.label}</strong>
            <span>准备完成后会自动返回刚才的操作。</span>
          </div>
        ) : null}

        <div className="environment-location-card">
          <div>
            <span>保存位置</span>
            <strong>{status?.resourceRoot ?? "尚未选择"}</strong>
            <small>{status?.freeSpaceBytes === null || status?.freeSpaceBytes === undefined ? "空间待确认" : `可用 ${formatBytes(status.freeSpaceBytes)}`}</small>
          </div>
          <div>
            <button className="button quiet" type="button" disabled={busy !== null || previewMode} onClick={chooseLocation}>
              {status?.configured ? "更改位置" : "选择位置"}
            </button>
            {status?.configured ? <button className="button quiet" type="button" disabled={busy !== null || previewMode} onClick={moveLocation}>移动保存位置</button> : null}
            <button className="button text" type="button" disabled={busy !== null || previewMode} onClick={chooseExisting}>选择已有资源目录</button>
          </div>
        </div>

        <div className="environment-local-capabilities">
          {(status?.capabilities ?? []).map((capability) => {
            const definition = catalog?.capabilities.find((item) => item.id === capability.id);
            const unavailable = definition?.resourceIds.some((resourceId) => {
              const resource = catalog?.resources.find((item) => item.id === resourceId);
              return resource?.distribution?.status === "unpublished";
            });
            const working = busy === `prepare:${capability.id}` || capability.state === "preparing";
            return (
              <article className={`environment-local-capability ${pendingAction?.capabilityId === capability.id ? "pending" : ""}`} key={capability.id}>
                <span className="environment-local-icon" aria-hidden="true">{capability.state === "ready" ? "✓" : "↓"}</span>
                <span>
                  <strong>{capability.title}</strong>
                  <small>{capabilityDescriptions[capability.id] ?? "按需准备此项本地能力。"}</small>
                </span>
                <span className={`environment-local-state ${capability.state === "ready" ? "ready" : ""}`}>{unavailable ? "下载资源尚未发布" : capabilityStateLabel(capability.state)}</span>
                {capability.state !== "ready" && !unavailable ? (
                  <button className="button quiet" type="button" disabled={busy !== null || previewMode || working} onClick={() => void prepare(capability.id)}>
                    {working ? "准备中…" : "准备"}
                  </button>
                ) : <i />}
              </article>
            );
          })}
        </div>

        {activeTasks.length > 0 ? (
          <section className="environment-downloads" aria-label="下载任务">
            <h3>正在进行</h3>
            {activeTasks.map((task) => {
              const progress = task.totalBytes > 0 ? Math.round(task.downloadedBytes / task.totalBytes * 100) : 0;
              return (
                <div className="environment-download-task" key={task.id}>
                  <span><strong>{task.resourceId}</strong><small>{taskStateLabel(task.state)} · {progress}%</small></span>
                  <progress max={100} value={progress} />
                  {task.state === "failed" ? <button className="button quiet" type="button" onClick={() => void controller.retryTask(task.id)}>重试</button> : null}
                </div>
              );
            })}
          </section>
        ) : null}

        <details className="environment-network-card">
          <summary>网络设置 <span>{networkStatus?.proxySource === "custom" ? "使用指定代理" : "自动选择"}</span></summary>
          <div>
            <label>
              <span>代理地址</span>
              <input value={proxyInput} placeholder="例如：http://127.0.0.1:7890" onChange={(event) => setProxyDraft(event.target.value)} />
            </label>
            <button className="button quiet" type="button" disabled={busy !== null || previewMode} onClick={() => void saveProxy()}>保存网络设置</button>
            <small>留空后按「环境变量 → Windows 系统代理 → 直连」自动选择。</small>
          </div>
        </details>
        {localError || error ? <div className="environment-error" role="alert">{localError ?? error}</div> : null}
      </div>
    </section>
  );
}
