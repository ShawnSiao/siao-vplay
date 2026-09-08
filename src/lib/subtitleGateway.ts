import { invoke } from "@tauri-apps/api/core";
import type { EmbeddedSubtitlePreview, SubtitleGlobalReplacement, SubtitleImportPreview, SubtitleSegmentEdit, SubtitleVersion } from "../types";
import { parseSubtitleMetadata, type SubtitleVersionMetadata } from "./subtitleMetadata";

export async function inspectSubtitleFile(
  projectId: string,
  subtitlePath: string,
  languageCode: string,
): Promise<SubtitleImportPreview> {
  return invoke<SubtitleImportPreview>("inspect_subtitle_file", {
    input: { projectId, subtitlePath, languageCode },
  });
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
  return invoke<SubtitleVersion>("import_subtitle_file", {
    input: {
      projectId,
      subtitlePath,
      languageCode,
      expectedSourceSha256: preview.sourceSha256,
      expectedMediaSha256: preview.expectedMediaSha256,
      expectedProjectRevision: preview.expectedProjectRevision,
    },
  });
}

export async function listSubtitleVersions(
  projectId: string,
  includeHistory = true,
): Promise<SubtitleVersion[]> {
  return invoke<SubtitleVersion[]>("list_subtitle_versions", { projectId, includeHistory });
}

export async function getSubtitleVersion(projectId: string, versionId: string): Promise<SubtitleVersion> {
  return invoke<SubtitleVersion>("get_subtitle_version", { projectId, versionId });
}

export async function listSubtitleVersionMetadata(projectId: string): Promise<SubtitleVersionMetadata[]> {
  return parseSubtitleMetadata(await invoke<unknown>("list_subtitle_version_metadata", { projectId }));
}

export async function reviseSubtitleVersion(
  projectId: string,
  baseVersionId: string,
  expectedProjectRevision: number,
  segmentEdits: SubtitleSegmentEdit[] = [],
  globalReplacement: SubtitleGlobalReplacement | null = null,
  offsetMs = 0,
): Promise<SubtitleVersion> {
  return invoke<SubtitleVersion>("revise_subtitle_version", {
    input: {
      projectId,
      baseVersionId,
      expectedProjectRevision,
      segmentEdits,
      globalReplacement,
      offsetMs,
    },
  });
}

export async function restoreSubtitleVersion(
  projectId: string,
  currentVersionId: string,
  restoreVersionId: string,
  expectedProjectRevision: number,
): Promise<SubtitleVersion> {
  return invoke<SubtitleVersion>("restore_subtitle_version", {
    input: {
      projectId,
      currentVersionId,
      restoreVersionId,
      expectedProjectRevision,
    },
  });
}

export async function inspectEmbeddedSubtitle(
  projectId: string,
  streamIndex: number,
  languageCode: string,
): Promise<EmbeddedSubtitlePreview> {
  return invoke<EmbeddedSubtitlePreview>("inspect_embedded_subtitle", {
    input: { projectId, streamIndex, languageCode },
  });
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
  return invoke<SubtitleVersion>("import_embedded_subtitle", {
    input: {
      projectId,
      streamIndex,
      languageCode,
      expectedSourceSha256: preview.sourceSha256,
      expectedMediaSha256: preview.expectedMediaSha256,
      expectedProjectRevision: preview.expectedProjectRevision,
    },
  });
}
