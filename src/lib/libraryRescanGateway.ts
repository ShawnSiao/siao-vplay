import { invoke } from "@tauri-apps/api/core";
import type { LibraryRescanPreview } from "../generated/library-rescan-preview";
import type { LibraryRescanResult } from "../generated/library-rescan-result";
import type { ApplyLibraryRescanInput } from "../types";
import validatePreview from "../generated/library-rescan-preview.validator.mjs";
import validateResult from "../generated/library-rescan-result.validator.mjs";

export async function inspectRescan(rootId: string): Promise<LibraryRescanPreview> {
  const value: unknown = await invoke("inspect_library_rescan", { rootId });
  const invalid = () => new Error("目录重扫预览无效，请重新扫描");
  if (!validatePreview(value) || value.rootId !== rootId || !value.previewToken.trim()
    || !value.collectionId.trim() || !value.rootPath.trim()) throw invalid();
  const items = [...value.missingItems, ...value.changedItems];
  const ids = items.map(item => item.projectId);
  const candidates = value.newCandidates.map(item => item.candidateId);
  if (items.some(item => item.collectionId !== value.collectionId || !item.projectId.trim())
    || new Set(ids).size !== ids.length || candidates.some(id => !id.trim())
    || new Set(candidates).size !== candidates.length) throw invalid();
  return value;
}

export async function applyRescan(input: ApplyLibraryRescanInput, preview: LibraryRescanPreview): Promise<LibraryRescanResult> {
  const { rootId, rootPath, collectionId, availableItemCount } = preview;
  const missingCount = preview.missingItems.length, changedCount = preview.changedItems.length, addedCount = input.newItems.length;
  if (input.previewToken !== preview.previewToken) throw new Error("重扫确认与预览不一致，请重新扫描");
  const value: unknown = await invoke("apply_library_rescan", { input });
  if (!validateResult(value) || value.root.id !== rootId || value.root.path !== rootPath
    || value.collection.summary.id !== collectionId || value.collection.summary.rootId !== rootId
    || value.addedItemCount !== addedCount || value.createdProjectCount + value.reusedProjectCount !== addedCount
    || value.missingItemCount !== missingCount || value.changedItemCount !== changedCount
    || value.availableItemCount !== availableItemCount) throw new Error("重扫返回结果无效，请刷新媒体库确认结果");
  return value;
}
