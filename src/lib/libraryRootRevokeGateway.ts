import { invoke } from "@tauri-apps/api/core";
import type { LibraryRootRevokeResult } from "../generated/library-root-revoke-result";
import validate from "../generated/library-root-revoke-result.validator.mjs";

export async function revokeRoot(rootId: string): Promise<LibraryRootRevokeResult> {
  const value: unknown = await invoke("revoke_library_root", { rootId });
  if (!validate(value) || value.rootId !== rootId) {
    throw new Error("撤销目录授权的返回结果无效，请刷新媒体库确认结果");
  }
  return value;
}
