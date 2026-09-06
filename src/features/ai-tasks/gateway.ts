import { invoke } from "@tauri-apps/api/core";

import type { ExplanationTask, LearningSelectionKind, LearningTask } from "../../types";
import type { AiExecutionTarget, AiMaterialAuthorization } from "../environment-settings/types";
import type { PromptSelection } from "../analysis/types";

export function prepareAiExplanationTask(input: {
  projectId: string;
  playbackCutoffMs: number;
  promptSelection: PromptSelection;
  execution: AiExecutionTarget;
  authorization: AiMaterialAuthorization;
}): Promise<ExplanationTask> {
  return invoke("prepare_ai_explanation_task", { input });
}

export function resumeExplanationTask(
  taskId: string,
  execution: AiExecutionTarget,
  authorization: AiMaterialAuthorization,
  confirmationSha256: string,
): Promise<ExplanationTask> {
  return invoke("resume_explanation_task", {
    input: { taskId, execution, authorization, confirmationSha256 },
  });
}

export function prepareAiLearningTask(input: {
  projectId: string;
  sourceSegmentId: string;
  selectedText: string;
  selectionKind: LearningSelectionKind;
  playbackPositionMs: number;
  execution: AiExecutionTarget;
  authorization: AiMaterialAuthorization;
}): Promise<LearningTask> {
  return invoke("prepare_ai_learning_task", { input });
}

export function resumeLearningTask(
  taskId: string,
  execution: AiExecutionTarget,
  authorization: AiMaterialAuthorization,
  confirmationSha256: string,
): Promise<LearningTask> {
  return invoke("resume_learning_task", {
    input: { taskId, execution, authorization, confirmationSha256 },
  });
}
