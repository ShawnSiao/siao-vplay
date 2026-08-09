import type { LibraryMediaSummary } from "../../../types";

export function libraryMediaNeedsRelink(media: LibraryMediaSummary): boolean {
  return (
    !media.mediaAvailable ||
    (media.itemAvailability !== null && media.itemAvailability !== "available")
  );
}

export function libraryMediaProgress(media: LibraryMediaSummary): number {
  return media.durationMs && media.durationMs > 0
    ? Math.round(
        Math.max(0, Math.min(100, (media.positionMs / media.durationMs) * 100)),
      )
    : 0;
}
