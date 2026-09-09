import { invoke } from "@tauri-apps/api/core";
import type { LibrarySectionPage } from "../generated/library-section-page";
import type { ListLibrarySectionInput } from "./libraryTypes";
import validate from "../generated/library-section-page.validator.mjs";

export async function readLibrarySection(input: ListLibrarySectionInput): Promise<LibrarySectionPage> {
  const invalid = () => new Error("媒体库分页数据无效，请重新加载列表");
  if (!Number.isSafeInteger(input.offset) || input.offset < 0) throw invalid();
  const value: unknown = await invoke("list_library_section", { input });
  if (!validate(value)) throw invalid();
  const loaded = input.offset + value.items.length;
  const ids = value.items.map(item => item.projectId);
  if (!Number.isSafeInteger(loaded) || ids.some(id => !id.trim()) || new Set(ids).size !== ids.length
    || value.totalCount < value.items.length) throw invalid();
  if (value.nextOffset === null) {
    if (loaded < value.totalCount) throw invalid();
  } else if (value.items.length === 0 || value.nextOffset !== loaded || value.nextOffset >= value.totalCount) {
    throw invalid();
  }
  return value;
}
