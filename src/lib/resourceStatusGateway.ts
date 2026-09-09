import { invoke } from "@tauri-apps/api/core";
import type { LocalResourceStatus, ResourceNetworkStatus } from "../types";
import { parseLocalResourceStatus, parseResourceNetworkStatus } from "./resourceStatusContract";
import { browserResourceCapabilities } from "./resourceBrowserCapabilities";
let browserSnapshotRevision = 0;
const isDesktopApp = "__TAURI_INTERNALS__" in window;

export async function getLocalResourceStatus(): Promise<LocalResourceStatus> {
  if (!isDesktopApp) {
    return {
      snapshotRevision: ++browserSnapshotRevision,
      configured: false,
      selectedParent: null,
      resourceRoot: null,
      rootState: "setup_required",
      freeSpaceBytes: null,
      preferredProfile: "standard",
      capabilities: browserResourceCapabilities.map((capability) => ({
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

export async function configureLocalResourceRoot(
  parentPath: string,
  confirmed: boolean,
): Promise<LocalResourceStatus> {
  return parseLocalResourceStatus(await invoke<unknown>("configure_local_resource_root", {
    input: { parentPath, confirmed },
  }));
}

export async function repairLocalResourceRoot(): Promise<LocalResourceStatus> {
  return parseLocalResourceStatus(await invoke<unknown>("repair_local_resource_root", {
    input: { confirmed: true },
  }));
}

export async function reconnectLocalResourceRoot(
  parentPath: string,
): Promise<LocalResourceStatus> {
  return parseLocalResourceStatus(await invoke<unknown>("reconnect_local_resource_root", {
    input: { parentPath, confirmed: true },
  }));
}

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
    return { mode: "direct", proxySource: "direct", proxyAddress: null };
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
