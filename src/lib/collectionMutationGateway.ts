import { invoke } from "@tauri-apps/api/core";
import type { Collection } from "../generated/library-collection";
import type { LibraryCollectionDeletionResult } from "../generated/collection-deletion-result";
import validateCollection from "../generated/library-collection.validator.mjs";
import validateDeletion from "../generated/collection-deletion-result.validator.mjs";

export async function invokeCollectionMutation(
  command: "create_collection" | "update_collection", input: object, collectionId?: string,
): Promise<Collection> {
  const value: unknown = await invoke(command, { input });
  if (!validateCollection(value) || !value.id.trim()
    || (collectionId !== undefined && value.id !== collectionId)) {
    throw new Error("返回的合集数据无效，请重新加载确认修改结果");
  }
  return value;
}

export async function invokeCollectionDeletion(collectionId: string): Promise<LibraryCollectionDeletionResult> {
  const value: unknown = await invoke("delete_collection", { collectionId });
  if (!validateDeletion(value) || value.collectionId !== collectionId
    || (value.rootId === null) !== (value.rootStatus === null)
    || (value.rootId !== null && !value.rootId.trim())) {
    throw new Error("合集删除结果无效，请重新加载确认结果");
  }
  return value;
}
