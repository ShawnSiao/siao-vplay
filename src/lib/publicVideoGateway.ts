import { invoke } from "@tauri-apps/api/core";
import { invokeProject } from "./projectGateway";
import type { Project, YouTubeMediaPreview } from "../types";

export async function inspectYouTubeUrl(
  url: string,
  authorizedResolverBase?: string | null,
): Promise<YouTubeMediaPreview> {
  const expectedUrl = httpsUrl(url).href;
  const value = await invoke<unknown>("inspect_youtube_url", {
    input: { url },
    authorizedResolverBase,
  });
  const { default: validate } = await import("../generated/public-video-preview.validator.mjs");
  if (!validate(value) || httpsUrl(value.originalUrl).href !== expectedUrl ||
      !value.videoId.trim() || !value.title.trim() || !value.importerVersion.trim() ||
      value.durationSeconds <= 0 || !/^[a-f0-9]{64}$/i.test(value.importerSha256) ||
      !/^[a-f0-9]{64}$/i.test(value.previewToken)) throw invalidResult();
  httpsUrl(value.webpageUrl);
  return value;
}

export async function importYouTubeUrl(
  url: string,
  expectedPreviewToken: string,
  operationId: string,
  authorizedResolverBase?: string | null,
): Promise<Project> {
  return invokeProject("import_youtube_url", {
    authorizedResolverBase,
    input: {
      url,
      expectedPreviewToken,
      operationId,
    },
  });
}

export async function cancelYouTubeImport(
  operationId: string,
): Promise<boolean> {
  const value = await invoke<unknown>("cancel_youtube_import", {
    input: { operationId },
  });
  if (typeof value !== "boolean") throw invalidResult();
  return value;
}

export async function getPublicResolverDisclosure() {
  const value = await invoke<unknown>("get_public_resolver_disclosure");
  const { default: validate } = await import("../generated/resolver-disclosure.validator.mjs");
  if (!validate(value)) throw invalidResult();
  const base = httpsUrl(value.resolverBase);
  if (base.origin !== value.receiver || base.search || base.hash) throw invalidResult();
  return value;
}

function httpsUrl(value: string): URL {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" || url.username || url.password) throw invalidResult();
    return url;
  } catch { throw invalidResult(); }
}

function invalidResult(): Error {
  return new Error("公开视频处理结果格式或来源不匹配，请重新检查链接。");
}
