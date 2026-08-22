import type { LocalResourceCapabilityStatus } from "../../types";
import type { LocalResourcesController } from "../resources/useLocalResources";

export async function updateCapabilityResources(
  controller: LocalResourcesController,
  capability: LocalResourceCapabilityStatus,
) {
  const details = await controller.loadDiagnostics();
  const requiredResourceIds = new Set(capability.requiredResourceIds);
  const updatedResourceIds = details.diagnostics.resources
    .filter(
      (resource) =>
        requiredResourceIds.has(resource.id) &&
        resource.state === "update_available",
    )
    .map((resource) => resource.id);
  for (const resourceId of updatedResourceIds) {
    await controller.updateResource(resourceId);
  }
  return { ...details, updatedResourceIds };
}
