import {
  LocalResourcesDialog,
  type PendingResourceAction,
} from "../../components/LocalResourcesDialog";
import type { LocalResourcesController } from "../resources/useLocalResources";

type LocalFeaturesPaneProps = {
  controller: LocalResourcesController;
  pendingAction: PendingResourceAction | null;
  previewMode: boolean;
  onNotice: (message: string) => void;
};

export function LocalFeaturesPane({
  controller,
  pendingAction,
  previewMode,
  onNotice,
}: LocalFeaturesPaneProps) {
  const readyCount = controller.status?.capabilities.filter(
    (capability) => capability.state === "ready" || capability.state === "update_available",
  ).length ?? 0;
  const totalCount = controller.status?.capabilities.length ?? 0;

  return (
    <section className="environment-local-pane" aria-label="本地功能">
      <div className="environment-local-v3-scroll">
        <header className="environment-local-v3-heading">
          <div>
            <h2>本地功能</h2>
            <p>只下载需要的内容，并保存到自行选择的位置。</p>
            <small>选择位置不会开始下载；共享内容只下载一次。</small>
          </div>
          <span className={`environment-status-chip ${controller.status?.configured ? "" : "unavailable"}`}>
            {controller.status?.configured
              ? `${readyCount} / ${totalCount} 项可用`
              : "等待设置位置"}
          </span>
        </header>
        <LocalResourcesDialog
          embedded
          controller={controller}
          firstRun={false}
          pendingAction={pendingAction}
          previewMode={previewMode}
          onClose={() => undefined}
          onDismissFirstRun={() => undefined}
          onNotice={onNotice}
        />
      </div>
    </section>
  );
}
