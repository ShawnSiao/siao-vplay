import { invoke } from "@tauri-apps/api/core";
import type { LibraryScanPreview } from "../generated/library-scan-preview";
import validate from "../generated/library-scan-preview.validator.mjs";

export async function readLibraryScanPreview(input: { scanId: string; rootPath: string }): Promise<LibraryScanPreview> {
  const value: unknown = await invoke("scan_library_folder", { input });
  const invalid = () => new Error("文件夹扫描结果无效，请重新扫描");
  if (!validate(value) || value.scanId !== input.scanId || !value.previewToken.trim() || !value.rootPath.trim()) throw invalid();
  const ids = value.candidates.map(item => item.candidateId);
  if (ids.some(id => !id.trim()) || new Set(ids).size !== ids.length
    || value.needsConfirmationCount !== value.candidates.filter(item => item.needsConfirmation).length
    || value.ignoredCount < value.ignoredEntries.length) throw invalid();
  return value;
}
