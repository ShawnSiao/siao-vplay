import { useTaskPolling, taskPollingIntervals } from "../ai-tasks/useTaskPolling";
import type { LearningTask } from "../../types";
type Options = { projectId: string; task: LearningTask | null; read: (id: string) => Promise<LearningTask>;
  onTask: (task: LearningTask) => void; onError: (cause: unknown) => void };
const shouldPoll = (task: LearningTask) => ["awaiting_external_result", "running", "validating"].includes(task.status);
export function useLearningPolling(options: Options) {
  useTaskPolling({ ...options, shouldPoll, intervalMs: taskPollingIntervals.learning });
}
