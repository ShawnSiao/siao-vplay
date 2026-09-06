import { LocalResourcesDialog } from "../components/LocalResourcesDialog";
import { EnvironmentSettingsDialog } from "../features/environment-settings/EnvironmentSettingsDialog";
import type { LocalResourcesController } from "../features/resources/useLocalResources";

export function RuntimeView({ controller }: { controller: LocalResourcesController }) {
  const capabilityId = new URLSearchParams(window.location.search).get("pending");
  const pendingAction = capabilityId ? { id: "fixture-pending", capabilityId, label: "继续当前操作" } : null;
  const environmentMode = new URLSearchParams(window.location.search).has("environment");
  const storagePreviewMode = new URLSearchParams(window.location.search).has("storage");
  if (environmentMode) {
    return (
      <EnvironmentSettingsDialog
        localResources={controller}
        firstRun={false}
        pendingAction={pendingAction}
        previewMode={storagePreviewMode}
        onClose={() => undefined}
        onDismissFirstRun={() => undefined}
        onNotice={() => undefined}
      />
    );
  }
  return (
    <LocalResourcesDialog
      controller={controller}
      firstRun={false}
      pendingAction={pendingAction}
      previewMode={false}
      onClose={() => undefined}
      onDismissFirstRun={() => undefined}
      onNotice={() => undefined}
    />
  );
}
