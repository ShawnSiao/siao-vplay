import { useTaskPolling, taskPollingIntervals } from "../ai-tasks/useTaskPolling";
import type { SubtitleBurnJob } from "../../types";
type Options = { projectId: string; task: SubtitleBurnJob | null; read: (id: string) => Promise<SubtitleBurnJob>;
  onTask: (task: SubtitleBurnJob) => void; onError: (cause: unknown) => void };
const shouldPoll = (task: SubtitleBurnJob) => ["queued", "running", "validating"].includes(task.status);
export function useBurnPolling(options: Options) {
  useTaskPolling({ ...options, shouldPoll, intervalMs: taskPollingIntervals.burn });
}
