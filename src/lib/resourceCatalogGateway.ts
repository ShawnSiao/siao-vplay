import { invoke } from "@tauri-apps/api/core";
const isDesktopApp = "__TAURI_INTERNALS__" in window;
const unique = (values: string[]) => values.every(value => value.trim().length > 0) && new Set(values).size === values.length;
const known = (values: string[], ids: Set<string>) => values.every(value => ids.has(value));
function invalid(): never { throw new Error("资源目录清单无效，请重新检查应用版本和资源状态。"); }

export async function getLocalResourceCatalog() {
  const value = isDesktopApp ? await invoke<unknown>("get_local_resource_catalog") :
    (await import("./resourceCatalogPreview")).getBrowserResourceCatalog();
  const { default: validate } = await import("../generated/local-resource-catalog.validator.mjs");
  if (!validate(value) || value.productId !== "siaovplay" || value.packageProfile !== "app-only") invalid();
  const resourceIds = value.resources.map(resource => resource.id);
  const profileIds = value.profiles.map(profile => profile.id);
  const capabilityIds = value.capabilities.map(capability => capability.id);
  if (!unique(resourceIds) || !unique(profileIds) || !unique(capabilityIds) || !profileIds.includes("standard")) invalid();
  const resources = new Set(resourceIds), profiles = new Set(profileIds), capabilities = new Set(capabilityIds);
  for (const resource of value.resources) {
    if (resource.bundled || !/^[A-Za-z0-9._-]+$/.test(resource.id) || !/^[A-Za-z0-9._-]+$/.test(resource.version) ||
        resource.expectedDownloadSize === 0 || (resource.installedSize ?? 0) <= 0) invalid();
    if (resource.artifact) {
      if (!resource.artifact.url.startsWith("https://") || resource.artifact.size <= 0 ||
          !/^[a-fA-F0-9]{64}$/.test(resource.artifact.sha256) ||
          (resource.expectedDownloadSize !== null && resource.expectedDownloadSize !== resource.artifact.size)) invalid();
    } else if (resource.distribution?.status !== "pending_release_asset" || (resource.expectedDownloadSize ?? 0) <= 0) invalid();
  }
  if (value.profiles.some(profile => !known(profile.resourceIds, resources)) ||
      value.capabilities.some(capability => !known(capability.resourceIds, resources) || !known(capability.profileIds, profiles) ||
        !known(capability.requiresCapabilityIds, capabilities))) invalid();
  return value;
}
