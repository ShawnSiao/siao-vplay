import { invoke } from "@tauri-apps/api/core";
import type { LibraryRootRelocationPreview } from "../generated/library-relocation-preview";
import type { LibraryRootRelocationResult } from "../generated/library-relocation-result";
import validatePreview from "../generated/library-relocation-preview.validator.mjs";
import validateResult from "../generated/library-relocation-result.validator.mjs";

export async function inspectRelocation(rootId: string, newRootPath: string): Promise<LibraryRootRelocationPreview> {
  const value: unknown = await invoke("inspect_library_root_relocation", { input: { rootId, newRootPath } });
  if (!validatePreview(value) || value.rootId !== rootId || !value.previewToken.trim()
    || !value.currentRootPath.trim() || !value.newRootPath.trim()) throw new Error("目录迁移预览无效，请重新检查目录");
  return value;
}

export async function applyRelocation(preview: LibraryRootRelocationPreview): Promise<LibraryRootRelocationResult> {
  const { rootId, newRootPath, matchedItemCount, previewToken } = preview;
  const value: unknown = await invoke("apply_library_root_relocation", { input: { previewToken } });
  if (!validateResult(value) || value.root.id !== rootId || value.root.path !== newRootPath
    || value.updatedItemCount !== matchedItemCount) throw new Error("目录迁移返回结果无效，请刷新媒体库确认结果");
  return value;
}
