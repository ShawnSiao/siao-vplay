import type { SubtitleVersionMetadata } from "../lib/subtitleMetadata";

// Adapt existing test catalogs; production reads use the bounded native command.
export async function readMockSubtitlePage(read: (projectId: string) => Promise<SubtitleVersionMetadata[]>, projectId: string, offset: number) {
  const items = await read(projectId);
  return { projectId, offset, totalCount: items.length, nextOffset: offset + 24 < items.length ? offset + 24 : null,
    snapshotToken: "a".repeat(64), items: items.slice(offset, offset + 24), currentVersions: items.filter(item => item.isCurrent) };
}
