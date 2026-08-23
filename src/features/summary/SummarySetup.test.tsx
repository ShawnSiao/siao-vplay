import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import type { AiExecutionChoiceController } from "../ai-tasks/useAiExecutionChoice";
import { SummarySetup } from "./SummarySetup";
import type { SummaryScope } from "./types";

vi.mock("../analysis/gateway", () => ({
  listAnalysisPromptTemplates: vi.fn().mockResolvedValue([
    {
      id: "builtin:summary:automatic",
      taskType: "summary",
      baseTemplateId: "builtin:summary:automatic",
      name: "自动判断",
      customRequirements: "自动判断内容类型",
      isBuiltin: true,
      createdAtMs: 1,
      updatedAtMs: 1,
    },
  ]),
  saveAnalysisPromptTemplate: vi.fn(),
  deleteAnalysisPromptTemplate: vi.fn(),
}));

const execution = {
  settings: null,
  services: [],
  service: null,
  kind: "codex",
  serviceId: null,
  modelId: "",
  frames: true,
  loading: false,
  error: null,
  execution: { kind: "codex" },
  authorization: { subtitles: true, currentQuestion: true, frames: true, serviceRevision: null },
  setKind: vi.fn(),
  selectService: vi.fn(),
  setModelId: vi.fn(),
  setFrames: vi.fn(),
  preview: vi.fn(),
} as unknown as AiExecutionChoiceController;

function Harness() {
  const [scope, setScope] = useState<SummaryScope>("current_progress");
  const [spoiler, setSpoiler] = useState(false);
  return (
    <SummarySetup
      playbackCutoffMs={1_600_000}
      durationMs={5_200_000}
      scope={scope}
      mode="science_technology"
      promptSelection={{ templateId: "builtin:summary:automatic", oneTimeRequirements: "" }}
      spoilerConfirmed={spoiler}
      busy={false}
      runtime={{ available: true, authenticated: true, supported: true, version: "test", authMode: "chatgpt", minimumVersion: "1", errorCode: null, errorMessage: null }}
      execution={execution}
      translationAvailable
      onScopeChange={setScope}
      onModeChange={vi.fn()}
      onPromptChange={vi.fn()}
      onSpoilerConfirmedChange={setSpoiler}
      onError={vi.fn()}
      onStart={vi.fn()}
    />
  );
}

describe("SummarySetup", () => {
  it("requires an explicit spoiler confirmation for full-video analysis", async () => {
    render(<Harness />);
    const start = screen.getByRole("button", { name: "开始生成总结" });
    expect(start).toBeEnabled();
    fireEvent.click(screen.getByText("完整视频"));
    expect(start).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: /确认分析完整视频/ }));
    expect(start).toBeEnabled();
  });
});
