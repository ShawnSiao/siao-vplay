import { describe, expect, it } from "vitest";

import { backgroundResultNotice } from "./backgroundNotice";

describe("backgroundResultNotice", () => {
  it("only exposes final product-facing status", () => {
    expect(
      backgroundResultNotice({
        taskKind: "translation",
        taskId: "task-1",
        projectId: "project-1",
        status: "validating",
        outputId: null,
        message: "Agent result at C:\\private\\result.json",
      }),
    ).toBeNull();

    const completed = backgroundResultNotice({
      taskKind: "translation",
      taskId: "task-1",
      projectId: "project-1",
      status: "completed",
      outputId: "subtitle-1",
      message: "Agent result at C:\\private\\result.json",
    });
    expect(completed).toMatchObject({ title: "中文字幕已准备好", tone: "success" });
    expect(JSON.stringify(completed)).not.toMatch(/Agent|C:\\/);
  });
});
