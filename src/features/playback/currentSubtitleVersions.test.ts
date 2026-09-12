import { describe, expect, it } from "vitest";
import type { SubtitleVersion } from "../../types";
import { mergeCurrentSubtitleVersion } from "./currentSubtitleVersions";

const version = (trackId: string, versionNumber: number, isCurrent = true) => ({
  id: `${trackId}-${versionNumber}`, trackId, projectId: "project", versionNumber, isCurrent,
  segments: [{ text: `body-${versionNumber}` }],
}) as SubtitleVersion;

describe("playback current subtitle ownership", () => {
  it("does not replace the selected track with a completed historical result", () => {
    const current = [version("original", 3)];
    expect(mergeCurrentSubtitleVersion(current, version("original", 2, false))).toBe(current);
  });
  it("ignores a late snapshot that was current before a newer revision arrived", () => {
    const current = [version("original", 3)];
    expect(mergeCurrentSubtitleVersion(current, version("original", 2))).toBe(current);
  });
  it("replaces the current body while keeping the other current track and no history", () => {
    const translation = version("translation", 1);
    const next = version("original", 4);
    expect(mergeCurrentSubtitleVersion([version("original", 3), translation, version("original", 2, false)], next))
      .toEqual([next, translation]);
  });
});
