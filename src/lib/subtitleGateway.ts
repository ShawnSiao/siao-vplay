import { parseSubtitleBody, parseSubtitleBodies } from "./subtitleBodyContract";
import { invoke } from "@tauri-apps/api/core";
import type { EmbeddedSubtitlePreview, SubtitleGlobalReplacement, SubtitleImportPreview, SubtitleSegmentEdit, SubtitleVersion } from "../types";
import { parseSubtitleMetadata, type SubtitleVersionMetadata } from "./subtitleMetadata";

export async function inspectSubtitleFile(
  projectId: string,
  subtitlePath: string,
  languageCode: string,
): Promise<SubtitleImportPreview> {
  const { parseSubtitlePreview } = await import("./subtitlePreviewContract");
  return parseSubtitlePreview(await invoke<unknown>("inspect_subtitle_file", {
    input: { projectId, subtitlePath, languageCode },
  }), languageCode);
}

export async function importSubtitleFile(
  projectId: string,
  subtitlePath: string,
  languageCode: string,
  preview: Pick<
    SubtitleImportPreview,
    "sourceSha256" | "expectedMediaSha256" | "expectedProjectRevision"
  >,
): Promise<SubtitleVersion> {
  return parseSubtitleBody(await invoke<unknown>("import_subtitle_file", {
    input: {
      projectId,
      subtitlePath,
      languageCode,
      expectedSourceSha256: preview.sourceSha256,
      expectedMediaSha256: preview.expectedMediaSha256,
      expectedProjectRevision: preview.expectedProjectRevision,
    },
  }), projectId);
}

export async function listSubtitleVersions(
  projectId: string,
  includeHistory = true,
): Promise<SubtitleVersion[]> {
  return parseSubtitleBodies(await invoke<unknown>("list_subtitle_versions", { projectId, includeHistory }), projectId);
}

export async function getSubtitleVersion(projectId: string, versionId: string): Promise<SubtitleVersion> {
  return parseSubtitleBody(await invoke<unknown>("get_subtitle_version", { projectId, versionId }), projectId, versionId);
}

export async function listSubtitleVersionMetadata(projectId: string): Promise<SubtitleVersionMetadata[]> {
  const metadata = parseSubtitleMetadata(await invoke<unknown>("list_subtitle_version_metadata", { projectId }));
  if (metadata.some(version => version.projectId !== projectId) || new Set(metadata.map(version => version.id)).size !== metadata.length) {
    throw new Error("字幕版本列表与当前项目不匹配或包含重复版本。");
  }
  return metadata;
}

export async function reviseSubtitleVersion(
  projectId: string,
  baseVersionId: string,
  expectedProjectRevision: number,
  segmentEdits: SubtitleSegmentEdit[] = [],
  globalReplacement: SubtitleGlobalReplacement | null = null,
  offsetMs = 0,
): Promise<SubtitleVersion> {
  return parseSubtitleBody(await invoke<unknown>("revise_subtitle_version", {
    input: {
      projectId,
      baseVersionId,
      expectedProjectRevision,
      segmentEdits,
      globalReplacement,
      offsetMs,
    },
  }), projectId);
}

export async function restoreSubtitleVersion(
  projectId: string,
  currentVersionId: string,
  restoreVersionId: string,
  expectedProjectRevision: number,
): Promise<SubtitleVersion> {
  return parseSubtitleBody(await invoke<unknown>("restore_subtitle_version", {
    input: {
      projectId,
      currentVersionId,
      restoreVersionId,
      expectedProjectRevision,
    },
  }), projectId);
}

export async function inspectEmbeddedSubtitle(
  projectId: string,
  streamIndex: number,
  languageCode: string,
): Promise<EmbeddedSubtitlePreview> {
  const { parseEmbeddedPreview } = await import("./subtitlePreviewContract");
  return parseEmbeddedPreview(await invoke<unknown>("inspect_embedded_subtitle", {
    input: { projectId, streamIndex, languageCode },
  }), streamIndex, languageCode);
}

export async function importEmbeddedSubtitle(
  projectId: string,
  streamIndex: number,
  languageCode: string,
  preview: Pick<
    EmbeddedSubtitlePreview,
    "sourceSha256" | "expectedMediaSha256" | "expectedProjectRevision"
  >,
): Promise<SubtitleVersion> {
  return parseSubtitleBody(await invoke<unknown>("import_embedded_subtitle", {
    input: {
      projectId,
      streamIndex,
      languageCode,
      expectedSourceSha256: preview.sourceSha256,
      expectedMediaSha256: preview.expectedMediaSha256,
      expectedProjectRevision: preview.expectedProjectRevision,
    },
  }), projectId);
}
