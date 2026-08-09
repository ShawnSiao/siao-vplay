import type {
  EpisodeRecognition,
  LibraryScanCandidate,
  LibraryScanPreview,
} from "../../types";

export type LibraryImportDraftItem = {
  candidateId: string;
  relativePath: string;
  recognition: EpisodeRecognition;
  confirmationReason: string | null;
  initiallyNeedsConfirmation: boolean;
  originalDisplayTitle: string;
  originalSeasonNumber: number | null;
  originalEpisodeNumber: number | null;
  originalAbsoluteOrder: number;
  displayTitle: string;
  seasonNumber: number | null;
  episodeNumber: number | null;
  absoluteOrder: number;
  confirmed: boolean;
};

export function draftCandidateItems(
  candidates: LibraryScanCandidate[],
): LibraryImportDraftItem[] {
  return candidates.map((candidate) => ({
    candidateId: candidate.candidateId,
    relativePath: candidate.relativePath,
    recognition: candidate.recognition,
    confirmationReason: candidate.confirmationReason,
    initiallyNeedsConfirmation: candidate.needsConfirmation,
    originalDisplayTitle: candidate.displayTitle,
    originalSeasonNumber: candidate.seasonNumber,
    originalEpisodeNumber: candidate.episodeNumber,
    originalAbsoluteOrder: candidate.absoluteOrder,
    displayTitle: candidate.displayTitle,
    seasonNumber: candidate.seasonNumber,
    episodeNumber: candidate.episodeNumber,
    absoluteOrder: candidate.absoluteOrder,
    confirmed: false,
  }));
}

export function draftItems(preview: LibraryScanPreview): LibraryImportDraftItem[] {
  return draftCandidateItems(preview.candidates);
}

export function importItemNeedsConfirmation(item: LibraryImportDraftItem): boolean {
  return (
    item.initiallyNeedsConfirmation ||
    item.displayTitle.trim() !== item.originalDisplayTitle ||
    item.seasonNumber !== item.originalSeasonNumber ||
    item.episodeNumber !== item.originalEpisodeNumber ||
    item.absoluteOrder !== item.originalAbsoluteOrder
  );
}
