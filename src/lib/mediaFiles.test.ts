import { describe, expect, it } from "vitest";

import { isSupportedVideoPath } from "./mediaFiles";

describe("isSupportedVideoPath", () => {
  it("accepts supported video extensions without depending on path casing", () => {
    expect(isSupportedVideoPath("W:\\Shows\\Episode 01.MKV")).toBe(true);
    expect(isSupportedVideoPath("/media/episode-02.webm")).toBe(true);
  });

  it("rejects folders, temporary files, and unsupported extensions", () => {
    expect(isSupportedVideoPath("W:\\Shows\\Season 01")).toBe(false);
    expect(isSupportedVideoPath("W:\\Shows\\episode.mp4.part")).toBe(false);
    expect(isSupportedVideoPath("W:\\Shows\\notes.txt")).toBe(false);
  });
});
