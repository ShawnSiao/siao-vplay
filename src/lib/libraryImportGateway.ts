import { invoke } from "@tauri-apps/api/core";
import type { LibraryImportResult } from "../generated/library-import-result";
import type { ConfirmLibraryImportInput } from "../types";
import validate from "../generated/library-import-result.validator.mjs";

export async function importLibraryPreview(input: ConfirmLibraryImportInput): Promise<LibraryImportResult> {
  const expectedCount = input.items.length;
  const value: unknown = await invoke("confirm_library_import", { input });
  const invalid = () => new Error("导入返回结果无效，请刷新媒体库确认结果");
  if (!validate(value) || !value.rootId.trim() || !value.collection.summary.id.trim()
    || value.collection.summary.rootId !== value.rootId
    || value.importedItemCount !== expectedCount
    || value.createdProjectCount + value.reusedProjectCount !== value.importedItemCount) throw invalid();
  return value;
}
