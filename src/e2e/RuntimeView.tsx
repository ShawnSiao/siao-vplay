import { useState } from "react";
import { LocalResourcesDialog } from "../components/LocalResourcesDialog";
import { EnvironmentSettingsDialog } from "../features/environment-settings/EnvironmentSettingsDialog";
import { useLocalResources, type LocalResourcesController } from "../features/resources/useLocalResources";

export function RuntimeView({ controller }: { controller: LocalResourcesController }) {
  const [closed, setClosed] = useState(false);
  const capabilityId = new URLSearchParams(window.location.search).get("pending");
  const pendingAction = capabilityId ? { id: "fixture-pending", capabilityId, label: "继续当前操作" } : null;
  const environmentMode = new URLSearchParams(window.location.search).has("environment");
  const storagePreviewMode = new URLSearchParams(window.location.search).has("storage");
  if (environmentMode) {
    if (closed) return <button onClick={() => setClosed(false)}>重新打开设置</button>;
    return (
      <EnvironmentSettingsDialog
        localResources={controller}
        firstRun={new URLSearchParams(window.location.search).has("firstRun")}
        pendingAction={pendingAction}
        previewMode={storagePreviewMode}
        onClose={() => setClosed(true)}
        onDismissFirstRun={() => setClosed(true)}
        onNotice={() => undefined}
      />
    );
  }
  return (
    <LocalResourcesDialog
      controller={controller}
      firstRun={new URLSearchParams(window.location.search).has("firstRun")}
      pendingAction={pendingAction}
      previewMode={false}
      onClose={() => undefined}
      onDismissFirstRun={() => undefined}
      onNotice={() => undefined}
    />
  );
}

export function LiveRuntimeView() {
  const controller = useLocalResources();
  return <RuntimeView controller={controller} />;
}
