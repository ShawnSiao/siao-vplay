import { validCleanupOutcome } from "./cleanupOutcome";
import { invoke } from "@tauri-apps/api/core";
import validateRemoval from "../generated/resource-removal-result.validator.mjs";
import validateRollback from "../generated/resource-rollback-result.validator.mjs";
import validateUnusedPlan from "../generated/unused-resource-cleanup-plan.validator.mjs";
import validateUnusedResult from "../generated/unused-resource-cleanup-result.validator.mjs";
import validateOldPlan from "../generated/old-resource-version-cleanup-plan.validator.mjs";
import validateOldResult from "../generated/old-resource-version-cleanup-result.validator.mjs";
const ids = (values: string[]) => values.every(value => value.trim().length > 0) && new Set(values).size === values.length;
function invalid(): never { throw new Error("资源维护结果无效或与当前操作不匹配，请刷新资源状态后检查。"); }
export async function planUnusedResourceCleanup() {
  const value = await invoke<unknown>("plan_unused_resource_cleanup");
  if (!validateUnusedPlan(value) || !ids(value.resourceIds) || !value.confirmationRequired) invalid();
  return value;
}
export async function cleanupUnusedResources(planFingerprint: string) {
  if (!/^[a-f0-9]{64}$/.test(planFingerprint)) invalid();
  const value = await invoke<unknown>("cleanup_unused_resources", { input: { confirmed: true, planFingerprint } });
  if (!validateUnusedResult(value) || !validCleanupOutcome(value.removedResourceIds, value.reclaimedBytes, value.interruption)) invalid();
  return value;
}
export async function removeLocalResource(resourceId: string, confirmed: boolean) {
  const value = await invoke<unknown>("remove_local_resource", { input: { resourceId, confirmed } });
  if (!validateRemoval(value) || !resourceId.trim() || value.resourceId !== resourceId || !ids(value.affectedCapabilityIds)) invalid();
  return value;
}
export async function rollbackLocalResource(resourceId: string, version: string) {
  const value = await invoke<unknown>("rollback_local_resource", { input: { resourceId, version, confirmed: true } });
  if (!validateRollback(value) || !resourceId.trim() || !version.trim() || !value.previousVersion.trim() ||
      value.resourceId !== resourceId || value.activeVersion !== version) invalid();
  return value;
}
export async function planOldResourceVersionCleanup() {
  const value = await invoke<unknown>("plan_old_resource_version_cleanup");
  if (!validateOldPlan(value)) invalid();
  const versions = value.candidates.map(candidate => `${candidate.resourceId}@${candidate.version}`);
  const bytes = value.candidates.reduce((sum, candidate) => sum + candidate.reclaimableBytes, 0);
  if (!value.confirmationRequired || !ids(value.protectedVersions) || !ids(versions) ||
      value.candidates.some(candidate => !candidate.resourceId.trim() || !candidate.version.trim()) ||
      versions.some(version => value.protectedVersions.includes(version)) ||
      !Number.isSafeInteger(bytes) || bytes !== value.reclaimableBytes) invalid();
  return value;
}
export async function cleanupOldResourceVersions(planFingerprint: string) {
  if (!/^[a-f0-9]{64}$/.test(planFingerprint)) invalid();
  const value = await invoke<unknown>("cleanup_old_resource_versions", { input: { confirmed: true, planFingerprint } });
  if (!validateOldResult(value) || !validCleanupOutcome(value.removedVersions, value.reclaimedBytes, value.interruption)) invalid();
  return value;
}
