import { useCallback, useState } from "react";

export type TrackedTranscription = { jobId: string; projectId: string };

export function useTranscriptionRegistry() {
  const [jobs, setJobs] = useState<TrackedTranscription[]>([]);
  const register = useCallback((jobId: string, projectId: string) => {
    setJobs(current => current.some(job => job.jobId === jobId)
      ? current : [...current, { jobId, projectId }]);
  }, []);
  const finish = useCallback((jobId: string) => {
    setJobs(current => current.some(job => job.jobId === jobId)
      ? current.filter(job => job.jobId !== jobId) : current);
  }, []);
  return { jobs, register, finish };
}
