import { invoke } from "@tauri-apps/api/core";
import type { LibraryRootRebuildPreview } from "../generated/library-rebuild-preview";
import type { LibraryRootRebuildResult } from "../generated/library-rebuild-result";
import type { ApplyLibraryRootRebuildInput, InspectLibraryRootRebuildInput } from "../types";
import validatePreview from "../generated/library-rebuild-preview.validator.mjs";
import validateResult from "../generated/library-rebuild-result.validator.mjs";

export async function inspectRebuild(input: InspectLibraryRootRebuildInput): Promise<LibraryRootRebuildPreview> {
  const value: unknown = await invoke("inspect_library_root_rebuild", { input });
  const invalid = () => new Error("目录重建预览无效，请重新检查目录");
  if (!validatePreview(value) || value.rootId !== input.rootId || !value.previewToken.trim()
    || !value.rootPath.trim() || !value.currentRootPath.trim()) throw invalid();
  const groups = [value.matchedItems, value.missingItems, value.changedItems, value.uncertainItems];
  const kinds = ["matched", "missing", "changed", "needs_confirmation"];
  const ids = groups.flat().map(item => item.projectId);
  const candidates = value.newCandidates.map(item => item.candidateId);
  if (ids.some(id => !id.trim()) || new Set(ids).size !== ids.length
    || candidates.some(id => !id.trim()) || new Set(candidates).size !== candidates.length
    || groups.some((items, index) => items.some(item => item.matchKind !== kinds[index]))) throw invalid();
  return value;
}

export async function applyRebuild(input: ApplyLibraryRootRebuildInput, preview: LibraryRootRebuildPreview): Promise<LibraryRootRebuildResult> {
  const { rootId, rootPath } = preview;
  const restoredCount = preview.matchedItems.length + preview.missingItems.length + preview.changedItems.length + preview.uncertainItems.length;
  const addedCount = input.newItems.length;
  if (input.previewToken !== preview.previewToken) throw new Error("重建确认与预览不一致，请重新检查目录");
  const value: unknown = await invoke("apply_library_root_rebuild", { input });
  if (!validateResult(value) || value.root.id !== rootId || value.root.path !== rootPath
    || value.collection.summary.rootId !== rootId || !value.collection.summary.id.trim()
    || value.restoredItemCount !== restoredCount || value.addedItemCount !== addedCount
    || value.createdProjectCount + value.reusedProjectCount !== restoredCount + addedCount) {
    throw new Error("重建返回结果无效，请刷新媒体库确认结果");
  }
  return value;
}
