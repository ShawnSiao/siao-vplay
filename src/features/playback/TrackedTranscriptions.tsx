import { useTrackedTranscription } from "./useTrackedTranscription";
import type { TrackedTranscription } from "./useTranscriptionRegistry";

type TrackingOptions = Parameters<typeof useTrackedTranscription>[0];
type Props = Omit<TrackingOptions, "jobId" | "jobProjectId" | "paused"> & {
  jobs: TrackedTranscription[];
  pausedProjectId?: string;
};

function TrackedJob(props: TrackingOptions) {
  useTrackedTranscription(props);
  return null;
}

// Each mounted job owns its polling lifetime; finishing one does not stop its peers.
export function TrackedTranscriptions({ jobs, pausedProjectId, ...options }: Props) {
  return jobs.map(job => <TrackedJob
    key={job.jobId}
    {...options}
    jobId={job.jobId}
    jobProjectId={job.projectId}
    paused={pausedProjectId === job.projectId}
  />);
}
