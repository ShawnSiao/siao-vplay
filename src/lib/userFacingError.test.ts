import { describe, expect, it } from "vitest";

import { userFacingCommandError } from "./userFacingError";

describe("userFacingCommandError", () => {
  it("maps stable command codes to actionable Chinese", () => {
    expect(
      userFacingCommandError(
        { code: "media_runtime_unavailable", message: "ffmpeg missing" },
        "playback",
      ),
    ).toContain("环境配置");
  });

  it("never exposes unknown paths or commands", () => {
    const message = userFacingCommandError(
      {
        code: "unexpected_error",
        message: "spawn ffmpeg failed at C:\\Users\\Shawn\\private\\movie.mp4",
      },
      "playback",
    );

    expect(message).toBe("播放器没有完成这项操作。原文件、字幕和观看记录没有改变。");
    expect(message).not.toMatch(/ffmpeg|C:\\|movie\.mp4/i);
  });
});
