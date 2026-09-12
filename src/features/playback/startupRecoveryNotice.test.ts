import { expect, it } from "vitest";
import { startupRecoveryNotice } from "./startupRecoveryNotice";

it("does not invent interrupted work on an ordinary startup", () => {
  expect(startupRecoveryNotice(0)).toBeNull();
});
it("reports actual recovery count and the existing manual recovery entry", () => {
  expect(startupRecoveryNotice(2)).toEqual({
    title: "上次的原文字幕生成已中断",
    message: "2 项任务尚未完成。打开对应视频的字幕工具，可检查任务并重新开始。",
    tone: "warning",
  });
});
