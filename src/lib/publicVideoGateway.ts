import { invoke } from "@tauri-apps/api/core";
import { invokeProject } from "./projectGateway";
import type { Project, YouTubeMediaPreview } from "../types";

export async function inspectYouTubeUrl(
  url: string,
  authorizedResolverBase?: string | null,
): Promise<YouTubeMediaPreview> {
  return invoke<YouTubeMediaPreview>("inspect_youtube_url", {
    input: { url },
    authorizedResolverBase,
  });
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
  return invoke<boolean>("cancel_youtube_import", {
    input: { operationId },
  });
}

export async function getPublicResolverDisclosure(): Promise<{ receiver: string; resolverBase: string }> {
  return invoke("get_public_resolver_disclosure");
}
