import type { CodexRuntimeStatus } from "../../types";
import { AiExecutionConfirm } from "./AiExecutionConfirm";
import type { AiExecutionChoiceController } from "./useAiExecutionChoice";

type AiTaskExecutionSetupProps = {
  controller: AiExecutionChoiceController;
  runtime: CodexRuntimeStatus | null;
  allowFrames: boolean;
  translationAvailable: boolean;
  taskLabel: string;
  summaryScope?: "current_progress" | "full_video";
  actionLabel: string;
  operationLabel: string;
  buttonClassName: string;
  busy: boolean;
  blocked: boolean;
  onStart: () => void;
};

export function AiTaskExecutionSetup({
  controller,
  runtime,
  allowFrames,
  translationAvailable,
  taskLabel,
  summaryScope,
  actionLabel,
  operationLabel,
  buttonClassName,
  busy,
  blocked,
  onStart,
}: AiTaskExecutionSetupProps) {
  const runtimeReady = Boolean(runtime?.available && runtime.authenticated && runtime.supported);
  const unavailable = controller.kind === "codex" && !runtimeReady;
  return (
    <>
      <AiExecutionConfirm
        controller={controller}
        runtime={runtime}
        allowFrames={allowFrames}
        translationAvailable={translationAvailable}
        taskLabel={taskLabel}
        summaryScope={summaryScope}
      />
      <button
        className={`button primary ${buttonClassName}`}
        type="button"
        disabled={busy || blocked || unavailable || !controller.execution}
        onClick={onStart}
      >
        {busy ? operationLabel : actionLabel}
      </button>
    </>
  );
}
