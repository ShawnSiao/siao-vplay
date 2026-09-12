import { invoke } from "@tauri-apps/api/core";
function invalid(): never { throw new Error("远程媒体预览结果无效，请重新检查链接。"); }
function canonicalUrl(value: string): string {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" || url.username || url.password) invalid();
    return url.href;
  } catch { return invalid(); }
}
export async function inspectRemoteMediaUrl(url: string) {
  const expectedUrl = canonicalUrl(url);
  const value = await invoke<unknown>("inspect_remote_media_url", { input: { url } });
  const { default: validate } = await import("../generated/remote-media-preview.validator.mjs");
  if (!validate(value) || canonicalUrl(value.originalUrl) !== expectedUrl || !value.displayName.trim() ||
      !/^[a-f0-9]{64}$/i.test(value.previewToken)) invalid();
  canonicalUrl(value.finalUrl);
  return value;
}
export async function cancelRemoteMediaImport(operationId: string): Promise<boolean> {
  const value = await invoke<unknown>("cancel_remote_media_import", { input: { operationId } });
  if (typeof value !== "boolean") throw new Error("取消远程媒体导入的响应无效，请重试。");
  return value;
}
