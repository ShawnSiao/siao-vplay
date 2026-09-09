import { invoke } from "@tauri-apps/api/core";
const nonblank = (value: string) => value.trim().length > 0;
const unique = (values: string[]) => values.every(nonblank) && new Set(values).size === values.length;
function invalid(): never { throw new Error("资源迁移结果无效，请重新检查资源状态和所选目录。"); }
export async function planLocalResourceLocation(parentPath: string) {
  const value = await invoke<unknown>("plan_local_resource_location", { input: { parentPath } });
  const { default: validate } = await import("../generated/local-resource-location-plan.validator.mjs");
  if (!validate(value) || !value.confirmationRequired || !value.parentExists ||
      !nonblank(value.selectedParent) || !nonblank(value.resourceRoot)) invalid();
  return value;
}
export async function planLocalResourceMove(parentPath: string) {
  const value = await invoke<unknown>("plan_local_resource_move", { input: { parentPath } });
  const { default: validate } = await import("../generated/local-resource-move-plan.validator.mjs");
  if (!validate(value) || !value.confirmationRequired || !nonblank(value.previousRoot) ||
      !nonblank(value.selectedParent) || !nonblank(value.resourceRoot)) invalid();
  return value;
}
export async function moveLocalResourceRoot(parentPath: string, requestId: string) {
  const value = await invoke<unknown>("move_local_resource_root", { input: { parentPath, confirmed: true }, requestId });
  const { default: validate } = await import("../generated/local-resource-move-result.validator.mjs");
  if (!validate(value) || !value.previousRootRetained || !nonblank(value.previousRoot) || !nonblank(value.currentRoot)) invalid();
  return value;
}
export async function inspectLocalResourceMigration(sourcePath?: string) {
  const value = await invoke<unknown>("inspect_local_resource_migration", {
    input: { sourcePath: sourcePath ?? null, sourceKind: sourcePath ? "selected_directory" : null },
  });
  const { default: validate } = await import("../generated/resource-migration-preview.validator.mjs");
  if (!validate(value) || value.sources.length !== (sourcePath ? 1 : 0) || !unique(value.verifiedResourceIds) ||
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
export async function adoptLocalResources(sourcePath?: string) {
  const value = await invoke<unknown>("adopt_local_resources", {
    input: { sourcePath: sourcePath ?? null, sourceKind: sourcePath ? "selected_directory" : null, confirmed: true },
  });
  const { default: validate } = await import("../generated/resource-adoption-result.validator.mjs");
  if (!validate(value) || !unique([...value.adoptedResourceIds, ...value.alreadyActiveResourceIds]) ||
      !unique(value.rejectedResourceIds) || (value.adoptedResourceIds.length === 0 && value.reusableBytes !== 0)) invalid();
  // A rejected candidate copy may have the same resource ID as a successfully adopted copy.
  return value;
}
