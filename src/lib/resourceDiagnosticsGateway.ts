import { invoke } from "@tauri-apps/api/core";
import validateDiagnostics from "../generated/local-resource-diagnostics.validator.mjs";

const unique = (values: string[]) => values.every(value => value.trim().length > 0) && new Set(values).size === values.length;
function invalid(): never { throw new Error("资源诊断结果无效，请重新检查资源状态。"); }

export async function getLocalResourceDiagnostics() {
  const value = await invoke<unknown>("get_local_resource_diagnostics");
  if (!validateDiagnostics(value)) invalid();
  if (value.catalogSource !== "embedded" || value.remoteCatalogEnabled ||
      !["setup_required", "ready", "root_unavailable", "repair_required"].includes(value.rootState) ||
      !unique(value.resources.map(resource => resource.id)) || !unique(value.tasks.map(task => task.id))) invalid();
  for (const resource of value.resources) {
    if (!resource.versionsReadable && (resource.versions.length > 0 || resource.state !== "repair_required")) invalid();
    if (!["not_installed", "ready", "update_available", "repair_required"].includes(resource.state) ||
        !unique(resource.versions.map(version => version.version)) ||
        resource.versions.some(version => version.active !== (version.version === resource.activeVersion))) invalid();
  }
  return value;
}

export async function getLocalResourceDiagnosticSummary(): Promise<string> {
  const value = await invoke<unknown>("get_local_resource_diagnostic_summary");
  if (typeof value !== "string") invalid();
  return value;
}

export async function getLocalResourceThirdPartyNotices(): Promise<string> {
  const value = await invoke<unknown>("get_local_resource_third_party_notices");
  if (typeof value !== "string") invalid();
  return value;
}
