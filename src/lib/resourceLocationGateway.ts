import { invoke } from "@tauri-apps/api/core";
import type { LocalResourceLocationPlan, ResourceLocationResult } from "../types";
import { parseLocalResourceStatus } from "./resourceStatusContract";
import { parseResourceSnapshot } from "./resourceTaskContract";
function invalid(): never { throw new Error("资源位置恢复结果无效，请重新检查当前保存位置。"); }
async function parse(value: unknown): Promise<ResourceLocationResult> {
  const { default: validate } = await import("../generated/resource-location-result.validator.mjs");
  if (!validate(value) || !/^[a-f0-9]{64}$/.test(value.configurationFingerprint) ||
      (value.bindingError === null) !== (value.taskSnapshot !== null) || (value.bindingError !== null && !value.bindingError.trim())) invalid();
  parseLocalResourceStatus(value);
  if (value.taskSnapshot) { parseResourceSnapshot(value.taskSnapshot); if (value.configured && value.taskSnapshot.generation === 0) invalid(); }
  return value;
}
export async function configureLocalResourceRoot(confirmedPlan: LocalResourceLocationPlan): Promise<ResourceLocationResult> {
  const plan = { ...confirmedPlan };
  const { default: validate } = await import("../generated/local-resource-location-plan.validator.mjs");
  if (!validate(plan) || !plan.confirmationRequired || !plan.parentExists || !/^[a-f0-9]{64}$/.test(plan.planFingerprint) || !plan.selectedParent.trim() || !plan.resourceRoot.trim()) invalid();
  const result = await parse(await invoke<unknown>("configure_local_resource_root", {
    input: { parentPath: plan.selectedParent, resourceRoot: plan.resourceRoot, planFingerprint: plan.planFingerprint, confirmed: true },
  }));
  if (!result.configured || result.selectedParent !== plan.selectedParent || result.resourceRoot !== plan.resourceRoot) invalid();
  return result;
}
export async function repairLocalResourceRoot() { return parse(await invoke<unknown>("repair_local_resource_root", { input: { confirmed: true } })); }
export async function reconnectLocalResourceRoot(parentPath: string) { return parse(await invoke<unknown>("reconnect_local_resource_root", { input: { parentPath, confirmed: true } })); }
export async function inspectLocalResourceBinding() { return parse(await invoke<unknown>("inspect_local_resource_binding")); }
export async function retryLocalResourceBinding(reviewed: ResourceLocationResult) {
  const resourceRoot = reviewed.resourceRoot, configurationFingerprint = reviewed.configurationFingerprint;
  if (!resourceRoot?.trim() || !/^[a-f0-9]{64}$/.test(configurationFingerprint)) invalid();
  const result = await parse(await invoke<unknown>("retry_local_resource_binding", { input: { resourceRoot, configurationFingerprint } }));
  if (result.resourceRoot !== resourceRoot || result.configurationFingerprint !== configurationFingerprint) invalid();
  return result;
}
