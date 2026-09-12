import validateStatus from "../generated/local-resource-status.validator.mjs";
import validateNetwork from "../generated/resource-network-status.validator.mjs";
import type { LocalResourceStatus, ResourceNetworkStatus } from "../types";
const uniqueIds = (ids: string[]) => ids.every(id => id.trim()) && new Set(ids).size === ids.length;
export function parseLocalResourceStatus(value: unknown, profileId?: string): LocalResourceStatus {
  if (!validateStatus(value) || !value.preferredProfile.trim() ||
      (profileId !== undefined && value.preferredProfile !== profileId) ||
      !uniqueIds(value.capabilities.map(capability => capability.id)) ||
      value.capabilities.some(capability => !capability.title.trim() ||
        !uniqueIds(capability.requiredResourceIds) || !uniqueIds(capability.missingResourceIds) ||
        capability.missingResourceIds.some(id => !capability.requiredResourceIds.includes(id)) ||
        (capability.state === "ready" && capability.missingResourceIds.length !== 0))) {
    throw new Error("资源状态格式无效或与当前设置不匹配。");
  }
  return value;
}
export function parseResourceNetworkStatus(value: unknown): ResourceNetworkStatus {
  if (!validateNetwork(value) ||
      (value.proxySource === "direct" ? value.mode !== "direct" || value.proxyAddress !== null : value.mode !== "proxy") ||
      (["custom", "windows_system"].includes(value.proxySource) && !value.proxyAddress?.trim()) ||
      (value.proxyAddress !== null && !value.proxyAddress.trim())) {
    throw new Error("网络状态格式无效，无法确认当前连接方式。");
  }
  return value;
}
