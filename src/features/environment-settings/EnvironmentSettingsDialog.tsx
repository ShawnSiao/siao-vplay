import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";

import type { PendingResourceAction } from "../../components/LocalResourcesDialog";
import type { LocalResourcesController } from "../resources/useLocalResources";
import { AiServiceEditor } from "./AiServiceEditor";
import { AiServiceList } from "./AiServiceList";
import { LocalCodexDetail } from "./LocalCodexDetail";
import { LocalFeaturesPane } from "./LocalFeaturesPane";
import { listenEnvironmentSettings } from "./events";
import { codexSelectionId } from "./serviceSelection";
import { useEnvironmentSettings } from "./useEnvironmentSettings";
import { StoragePane } from "../storage/StoragePane";
import { useStorageSettings } from "../storage/useStorageSettings";
import "./environment-settings-shell.css";
import "./environment-settings-content.css";
import "./local-features-v3.css";

type EnvironmentSettingsDialogProps = {
  localResources: LocalResourcesController;
  firstRun: boolean;
  pendingAction: PendingResourceAction | null;
  previewMode: boolean;
  onClose: () => void;
  onDismissFirstRun: () => void;
  onNotice: (message: string) => void;
};

export function EnvironmentSettingsDialog({
  localResources,
  firstRun,
  pendingAction,
  previewMode,
  onClose,
  onDismissFirstRun,
  onNotice,
}: EnvironmentSettingsDialogProps) {
  const [tab, setTab] = useState<"local" | "ai" | "storage">("local");
  const [codexRefreshKey, setCodexRefreshKey] = useState(0);
  const controller = useEnvironmentSettings(true, previewMode);
  const storage = useStorageSettings(tab === "storage", previewMode, onNotice);
  const dialogRef = useRef<HTMLElement>(null);
  const titleId = useId();
  const requestClose = useCallback(() => {
    if (controller.operation || storage.operation) return;
    if (controller.dirtySelectionIds.length &&
        !window.confirm("还有未保存的 AI 服务配置。确定放弃这些修改并关闭？选择取消可继续编辑和保存。")) return;
    onClose();
  }, [controller.dirtySelectionIds, controller.operation, onClose, storage.operation]);
  const requestCloseRef = useRef(requestClose);
  useLayoutEffect(() => { requestCloseRef.current = requestClose; }, [requestClose]);

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusable = () => {
      const scope = dialogRef.current?.querySelector(".storage-migration-dialog") ?? dialogRef.current;
      return Array.from(scope?.querySelectorAll<HTMLElement>(
      'button:not(:disabled), input:not(:disabled), select:not(:disabled), summary, [tabindex]:not([tabindex="-1"])',
      ) ?? []);
    };
    focusable()[0]?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (dialogRef.current?.querySelector(".storage-migration-dialog")) return;
        event.preventDefault();
        event.stopPropagation();
        requestCloseRef.current();
      } else if (event.key === "Tab") {
        const items = focusable();
        const first = items[0];
        const last = items.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    window.addEventListener("keydown", keydown, true);
    return () => {
      window.removeEventListener("keydown", keydown, true);
      if (previous?.isConnected) previous.focus();
    };
  }, []);

  useEffect(() => listenEnvironmentSettings(setTab), []);

  const configured = controller.service?.credentialState === "stored";
  const canSave = Boolean(
    controller.draft?.displayName.trim() &&
    controller.draft.modelId.trim() &&
    (configured || controller.draft.apiKey.trim()) &&
    (controller.draft.providerId !== "custom" || controller.draft.baseUrl.trim()),
  );
  const canTest = Boolean(
    controller.draft && (configured || controller.draft.apiKey.trim()),
  );
  const aiBusy = controller.operation !== null;
  const storageDirty = Boolean(storage.settings && (
    storage.subtitleDirectory !== storage.settings.defaultSubtitleExportDirectory ||
    storage.reportDirectory !== storage.settings.defaultVideoReportExportDirectory
  ));

  return (
    <div className="environment-settings-scrim" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) requestClose();
    }}>
      <section ref={dialogRef} className="environment-settings-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
        <header className="environment-settings-header">
          <div className="environment-title-group">
            <span>按需管理</span>
            <h1 id={titleId}>环境配置</h1>
            <p>管理本地功能、AI 服务、存储位置和隐私范围</p>
          </div>
          <nav className="environment-settings-tabs" aria-label="环境配置分类">
            <button className={tab === "local" ? "active" : ""} type="button" onClick={() => setTab("local")}>本地功能</button>
            <button className={tab === "ai" ? "active" : ""} type="button" onClick={() => setTab("ai")}>AI 服务</button>
            <button className={tab === "storage" ? "active" : ""} type="button" onClick={() => setTab("storage")}>存储</button>
          </nav>
          <button className="environment-settings-close" type="button" aria-label="关闭环境配置" onClick={requestClose}>×</button>
        </header>

        <div className="environment-settings-content">
          {tab === "local" ? (
            <LocalFeaturesPane controller={localResources} pendingAction={pendingAction} previewMode={previewMode} onNotice={onNotice} />
          ) : tab === "ai" ? (
            <div className="environment-ai-layout">
              <AiServiceList controller={controller} />
              {controller.selectionId === codexSelectionId ? <LocalCodexDetail previewMode={previewMode} refreshKey={codexRefreshKey} /> : <AiServiceEditor key={controller.selectionId} controller={controller} />}
            </div>
          ) : <StoragePane controller={storage} />}
        </div>

        <footer className="environment-settings-footer">
          <span>{tab === "local" ? "下载位置与本地功能状态在这里统一管理。" : tab === "ai" ? "配置只保存在这台电脑，使用时会再次确认发送范围。" : "默认位置只影响下次选择，导出时仍可临时更改。"}</span>
          {tab === "local" ? (
            <>
              {firstRun ? <button className="button text" type="button" onClick={onDismissFirstRun}>稍后配置</button> : null}
              <button className="button quiet" type="button" onClick={requestClose}>关闭</button>
            </>
          ) : tab === "storage" ? (
            <>
              <button className="button text" type="button" disabled={!storageDirty || storage.operation !== null} onClick={() => { storage.setSubtitleDirectory(null); storage.setReportDirectory(null); }}>恢复默认</button>
              <button className="button primary" type="button" disabled={!storageDirty || storage.operation !== null} onClick={() => void storage.saveDefaults()}>{storage.operation === "saving" ? "正在保存…" : "应用设置"}</button>
            </>
          ) : controller.selectionId === codexSelectionId ? (
            <button className="button quiet" type="button" onClick={() => setCodexRefreshKey((value) => value + 1)}>重新检测</button>
          ) : (
            <>
              <button className="button quiet" type="button" disabled={!canTest || aiBusy || previewMode} onClick={() => void controller.test()}>
                {controller.operation === "testing" ? "正在测试…" : "测试连接"}
              </button>
              <button className="button primary" type="button" disabled={!canSave || aiBusy || previewMode} onClick={() => void controller.save()}>
                {controller.operation === "saving" ? "正在保存…" : configured ? "保存设置" : "保存并使用"}
              </button>
            </>
          )}
        </footer>
      </section>
    </div>
  );
}
