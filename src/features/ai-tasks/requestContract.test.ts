import { createLearningTaskFixture } from "../../test-fixtures/learning";
import { beforeEach, expect, it, vi } from "vitest";
import { previewAiExecution } from "../environment-settings/gateway";
import { prepareAiExplanationTask, prepareAiLearningTask, resumeExplanationTask, resumeLearningTask } from "./gateway";
import type { AiExecutionTarget, AiMaterialAuthorization } from "../environment-settings/types";
import schema from "../../../contracts/ai-execution-request.schema.json";
import { aiExecutionRequest } from "../../lib/aiExecutionRequest";
const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => mocks);
beforeEach(() => { mocks.invoke.mockReset(); });
const execution: AiExecutionTarget = { kind: "api", serviceConfigId: "service", modelId: "model" };
const authorization: AiMaterialAuthorization = { subtitles: true, currentQuestion: true, frames: false, serviceRevision: 7 };

it.each(schema.examples)("accepts the Rust request wire shape %j", (payload) => {
  expect(aiExecutionRequest(payload.execution as AiExecutionTarget, payload.authorization)).toEqual(payload);
});

it("preserves task identity and confirmation while copying authorization", async () => {
  mocks.invoke.mockResolvedValue({ ...createLearningTaskFixture(), id: "task", handoffKind: "api", execution: { ...createLearningTaskFixture().execution, kind: "api" } });
  await resumeLearningTask("task", execution, authorization, "confirmed-hash");
  expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith("resume_learning_task", {
    input: { taskId: "task", execution, authorization, confirmationSha256: "confirmed-hash" },
  });
  const sent = mocks.invoke.mock.calls[0][1].input;
  expect(sent.execution).not.toBe(execution);
  expect(sent.authorization).not.toBe(authorization);
});

it.each([
  [{ kind: "invalid" }, authorization],
  [{ kind: "api", serviceConfigId: "service" }, authorization],
  [{ ...execution, modelId: " " }, authorization],
  [execution, { ...authorization, frames: "false" }],
  [execution, { ...authorization, serviceRevision: Number.MAX_SAFE_INTEGER + 1 }],
  [execution, { ...authorization, serviceRevision: null }],
  [execution, { ...authorization, currentQuestion: false }],
  [{ kind: "manual" }, authorization],
])("rejects malformed authorization before any IPC %j", async (target, materials) => {
  const execution = target as AiExecutionTarget;
  const authorization = materials as AiMaterialAuthorization;
  const common = { execution, authorization };
  const operations: Array<() => Promise<unknown>> = [
    () => previewAiExecution(execution, authorization),
    () => prepareAiExplanationTask({ ...common, projectId: "p", playbackCutoffMs: 1, promptSelection: { templateId: "template", oneTimeRequirements: "" } }),
    () => prepareAiLearningTask({ ...common, projectId: "p", sourceSegmentId: "s", selectedText: "text", selectionKind: "sentence", playbackPositionMs: 1 }),
    () => resumeExplanationTask("task", execution, authorization, "hash"),
    () => resumeLearningTask("task", execution, authorization, "hash"),
  ];
  for (const operation of operations) {
    await expect(Promise.resolve().then(operation)).rejects.toThrow("AI 处理方式或材料授权无效");
  }
  expect(mocks.invoke).not.toHaveBeenCalled();
});
