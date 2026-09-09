import { useTaskPolling, taskPollingIntervals } from "../ai-tasks/useTaskPolling";
import type { SummaryTask } from "./types";
type Options = { projectId: string; task: SummaryTask | null; read: (id: string) => Promise<SummaryTask>;
  onTask: (task: SummaryTask) => void; onError: (cause: unknown) => void };
const shouldPoll = (task: SummaryTask) => ["queued", "running", "validating"].includes(task.status);
export function useSummaryPolling(options: Options) {
  useTaskPolling({ ...options, shouldPoll, intervalMs: taskPollingIntervals.summary });
}
