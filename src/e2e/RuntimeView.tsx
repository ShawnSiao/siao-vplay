import { LocalResourcesDialog } from "../components/LocalResourcesDialog";
import { EnvironmentSettingsDialog } from "../features/environment-settings/EnvironmentSettingsDialog";
import type { LocalResourcesController } from "../features/resources/useLocalResources";

export function RuntimeView({ controller }: { controller: LocalResourcesController }) {
  const environmentMode = new URLSearchParams(window.location.search).has("environment");
  const storagePreviewMode = new URLSearchParams(window.location.search).has("storage");
  if (environmentMode) {
    return (
      <EnvironmentSettingsDialog
        localResources={controller}
        firstRun={false}
        pendingAction={null}
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
      pendingAction={null}
      previewMode={false}
      onClose={() => undefined}
      onDismissFirstRun={() => undefined}
      onNotice={() => undefined}
    />
  );
}
