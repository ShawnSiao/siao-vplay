import { expect, it } from "vitest";
import { translationCompletionNotice } from "./translationCompletionNotice";

it("directs other-video completion to its video without claiming current subtitles changed", () => {
  const notice = translationCompletionNotice({ segmentCount: 3, validation: null }, false);
  expect(notice).toMatchObject({ tone: "success" });
  expect(JSON.stringify(notice)).toContain("对应视频");
  expect(JSON.stringify(notice)).not.toContain("当前视频");
});
it("retains current-video completion detail", () => {
  expect(translationCompletionNotice({ segmentCount: 3, validation: null }, true)).toMatchObject({
    title: "中文字幕已准备好", message: expect.stringContaining("3 条草稿"), tone: "success",
  });
});
it("retains quality warnings for background results", () => {
  const task = { segmentCount: 3, validation: { warningCount: 2 } };
  const notice = translationCompletionNotice(task, false);
  expect(notice).toMatchObject({ tone: "warning", message: expect.stringContaining("2 项") });
  expect(JSON.stringify(notice)).toContain("对应视频");
});
