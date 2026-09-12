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

it("announces other-project completion and rejection without claiming the current video changed", () => {
  for (const status of ["completed", "rejected"] as const) {
    const notice = backgroundResultNotice({ taskKind: "translation", taskId: "other-task", projectId: "other-project", status, outputId: null, message: "C:\\private\\output.json" }, false);
    expect(notice).toMatchObject({ tone: status === "completed" ? "success" : "warning" });
    expect(JSON.stringify(notice)).toContain("其他视频");
    expect(JSON.stringify(notice)).not.toMatch(/当前视频|C:\\/);
  }
});
