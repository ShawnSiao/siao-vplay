import { invoke } from "@tauri-apps/api/core";
import type { LocalResourceStatus, LocalResourceLocationPlan, ResourceNetworkStatus } from "../types";
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

export async function configureLocalResourceRoot(confirmedPlan: LocalResourceLocationPlan): Promise<LocalResourceStatus> {
  const plan = { ...confirmedPlan };
  const { default: validate } = await import("../generated/local-resource-location-plan.validator.mjs");
  if (!validate(plan) || !plan.confirmationRequired || !plan.parentExists || !/^[a-f0-9]{64}$/.test(plan.planFingerprint) || !plan.selectedParent.trim() || !plan.resourceRoot.trim()) {
    throw new Error("保存位置确认无效，请重新选择并核对保存位置。");
  }
  const status = parseLocalResourceStatus(await invoke<unknown>("configure_local_resource_root", {
    input: { parentPath: plan.selectedParent, resourceRoot: plan.resourceRoot, planFingerprint: plan.planFingerprint, confirmed: true },
  }));
  if (!status.configured || status.selectedParent !== plan.selectedParent || status.resourceRoot !== plan.resourceRoot) {
    throw new Error("保存位置结果与确认不一致，请重新检查资源状态。");
  }
  return status;
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
