import { useTaskPolling, taskPollingIntervals } from "../ai-tasks/useTaskPolling";
import type { ExplanationTask } from "../../types";
type Options = { projectId: string; task: ExplanationTask | null; read: (id: string) => Promise<ExplanationTask>;
  onTask: (task: ExplanationTask) => void; onError: (cause: unknown) => void };
const shouldPoll = (task: ExplanationTask) => ["awaiting_external_result", "running", "validating"].includes(task.status);
export function useExplanationPolling(options: Options) {
  useTaskPolling({ ...options, shouldPoll, intervalMs: taskPollingIntervals.explanation });
}
