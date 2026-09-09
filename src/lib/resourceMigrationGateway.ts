import type { LocalResourceMovePlan, ResourceMigrationPreview } from "../types";
import { invoke } from "@tauri-apps/api/core";
const nonblank = (value: string) => value.trim().length > 0;
const unique = (values: string[]) => values.every(nonblank) && new Set(values).size === values.length;
function invalid(): never { throw new Error("资源迁移结果无效，请重新检查资源状态和所选目录。"); }
export async function planLocalResourceLocation(parentPath: string) {
  const value = await invoke<unknown>("plan_local_resource_location", { input: { parentPath } });
  const { default: validate } = await import("../generated/local-resource-location-plan.validator.mjs");
  if (!validate(value) || !/^[a-f0-9]{64}$/.test(value.planFingerprint) || !value.confirmationRequired || !value.parentExists ||
      !nonblank(value.selectedParent) || !nonblank(value.resourceRoot)) invalid();
  return value;
}
export async function planLocalResourceMove(parentPath: string) {
  const value = await invoke<unknown>("plan_local_resource_move", { input: { parentPath } });
  const { default: validate } = await import("../generated/local-resource-move-plan.validator.mjs");
  if (!validate(value) || !/^[a-f0-9]{64}$/.test(value.planFingerprint) || !value.confirmationRequired || !nonblank(value.previousRoot) ||
      !nonblank(value.selectedParent) || !nonblank(value.resourceRoot)) invalid();
  return value;
}
export async function moveLocalResourceRoot(confirmedPlan: LocalResourceMovePlan, requestId: string) {
  const plan = { ...confirmedPlan };
  const { default: validatePlan } = await import("../generated/local-resource-move-plan.validator.mjs");
  if (!validatePlan(plan) || !/^[a-f0-9]{64}$/.test(plan.planFingerprint) || !plan.confirmationRequired || plan.destinationExists || !nonblank(requestId)) invalid();
  const value = await invoke<unknown>("move_local_resource_root", { input: { parentPath: plan.selectedParent, planFingerprint: plan.planFingerprint, confirmed: true }, requestId });
  const { default: validate } = await import("../generated/local-resource-move-result.validator.mjs");
  if (!validate(value) || !value.previousRootRetained || value.requestId !== requestId || value.planFingerprint !== plan.planFingerprint ||
      value.previousRoot !== plan.previousRoot || value.currentRoot !== plan.resourceRoot || value.copiedBytes !== plan.bytesToCopy ||
      value.verifiedFileCount !== plan.fileCount || value.crossVolume !== plan.crossVolume) invalid();
  return value;
}
export async function inspectLocalResourceMigration(sourcePath?: string) {
  const value = await invoke<unknown>("inspect_local_resource_migration", {
    input: { sourcePath: sourcePath ?? null, sourceKind: sourcePath ? "selected_directory" : null },
  });
  return validateMigrationPreview(value, Boolean(sourcePath));
}
async function validateMigrationPreview(value: unknown, selected: boolean) {
  const { default: validate } = await import("../generated/resource-migration-preview.validator.mjs");
  if (!validate(value) || value.sources.length !== (selected ? 1 : 0) || !unique(value.verifiedResourceIds) ||
      !unique(value.sources.map(source => source.path)) ||
      value.sources.some(source => source.kind !== "selected_directory")) invalid();
  const verifiedIds = new Set<string>(); let bytes = 0; let rejected = 0;
  for (const candidate of value.candidates) {
    if (!nonblank(candidate.resourceId) || !nonblank(candidate.resourcePath) ||
        !value.sources.some(source => source.kind === candidate.sourceKind && source.path === candidate.sourceRoot)) invalid();
    if (candidate.state === "verified") { verifiedIds.add(candidate.resourceId); bytes += candidate.reusableBytes; }
    else if (candidate.state === "rejected" && candidate.reusableBytes === 0) rejected++;
    else invalid();
  }
  if (!Number.isSafeInteger(bytes) || bytes !== value.reusableBytes || rejected !== value.rejectedCount ||
      verifiedIds.size !== value.verifiedResourceIds.length || value.verifiedResourceIds.some(id => !verifiedIds.has(id))) invalid();
  return value;
}
export async function adoptLocalResources(confirmedPreview: ResourceMigrationPreview, requestId: string) {
  const snapshot = structuredClone(confirmedPreview);
  const preview = await validateMigrationPreview(snapshot, snapshot.sources.length > 0);
  if (!nonblank(requestId) || !preview.resourceRoot || !nonblank(preview.resourceRoot)) invalid();
  const source = preview.sources[0];
  const value = await invoke<unknown>("adopt_local_resources", {
    input: { resourceRoot: preview.resourceRoot, sourcePath: source?.path ?? null, sourceKind: source?.kind ?? null, planFingerprint: preview.planFingerprint, confirmed: true }, requestId,
  });
  const { default: validate } = await import("../generated/resource-adoption-result.validator.mjs");
  if (!validate(value) || value.requestId !== requestId || value.planFingerprint !== preview.planFingerprint || value.resourceRoot !== preview.resourceRoot ||
      !unique([...value.adoptedResourceIds, ...value.alreadyActiveResourceIds]) || !unique(value.rejectedResourceIds)) invalid();
  const verified = new Set(preview.verifiedResourceIds);
  const rejected = new Set(preview.candidates.filter(candidate => candidate.state === "rejected").map(candidate => candidate.resourceId));
  const unfinished = value.interruption ? [value.interruption.resourceId, ...value.interruption.unattemptedResourceIds] : [];
  const accounted = [...value.adoptedResourceIds, ...value.alreadyActiveResourceIds, ...unfinished];
  if (!unique(accounted) || accounted.length !== verified.size || accounted.some(id => !verified.has(id)) ||
      (value.interruption && !nonblank(value.interruption.message)) || value.rejectedResourceIds.length !== rejected.size ||
      value.rejectedResourceIds.some(id => !rejected.has(id))) invalid();
  const bytes = value.adoptedResourceIds.reduce((sum, id) => sum + (preview.candidates.find(candidate => candidate.resourceId === id && candidate.state === "verified")?.reusableBytes ?? 0), 0);
  if (!Number.isSafeInteger(bytes) || value.reusableBytes !== bytes) invalid();
  return value;
}
