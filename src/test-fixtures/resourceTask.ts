import type { ResourceDownloadTask } from "../types";
export function createResourceTaskFixture(): ResourceDownloadTask {
  return { id: "task", resourceId: "resource", version: "1", state: "queued", downloadedBytes: 0, totalBytes: 100,
    requestedByCapabilityIds: ["capability"], pendingActionIds: [], attempt: 1, errorCode: null, errorMessage: null,
    createdAtMs: 1, updatedAtMs: 1, forceReinstall: false, generation: 1, revision: 1 };
}
