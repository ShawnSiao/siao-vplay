import { invoke } from "@tauri-apps/api/core";
import type { LocalResourceStatus, ResourceNetworkStatus } from "../types";
import { parseLocalResourceStatus, parseResourceNetworkStatus } from "./resourceStatusContract";
let browserSnapshotRevision = 0;
const isDesktopApp = "__TAURI_INTERNALS__" in window;

export async function getLocalResourceStatus(): Promise<LocalResourceStatus> {
  if (!isDesktopApp) {
    const catalog = (await import("./resourceCatalogPreview")).getBrowserResourceCatalog();
    return {
      snapshotRevision: ++browserSnapshotRevision,
      configured: false,
      selectedParent: null,
      resourceRoot: null,
      rootState: "setup_required",
      freeSpaceBytes: null,
      preferredProfile: "standard",
      capabilities: catalog.capabilities.map((capability) => ({
        id: capability.id,
        title: capability.title,
        state: "setup_required" as const,
        requiredResourceIds: capability.resourceIds,
        missingResourceIds: capability.resourceIds,
      })),
    };
  }
  return parseLocalResourceStatus(await invoke<unknown>("get_local_resource_status"));
}

export { configureLocalResourceRoot, repairLocalResourceRoot, reconnectLocalResourceRoot } from "./resourceLocationGateway";

export async function setLocalResourceProfile(
  profileId: string,
): Promise<LocalResourceStatus> {
  if (!isDesktopApp) {
    const status = await getLocalResourceStatus();
    return { ...status, preferredProfile: profileId };
  }
  return parseLocalResourceStatus(await invoke<unknown>("set_local_resource_profile", {
    input: { profileId },
  }), profileId);
}

export async function getLocalResourceNetworkStatus(): Promise<ResourceNetworkStatus> {
  if (!isDesktopApp) {
    return { snapshotRevision: ++browserSnapshotRevision, mode: "direct", proxySource: "direct", proxyAddress: null };
  }
  return parseResourceNetworkStatus(await invoke<unknown>("get_local_resource_network_status"));
}

export async function setLocalResourceProxy(
  proxyUrl: string | null,
): Promise<ResourceNetworkStatus> {
  return parseResourceNetworkStatus(await invoke<unknown>("set_local_resource_proxy", {
    input: { proxyUrl },
  }));
}
