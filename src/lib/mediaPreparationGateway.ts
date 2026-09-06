import { invoke } from "@tauri-apps/api/core";

export type MediaPreparationProgress = {
  requestId: string;
  projectId: string;
  stage: "queued" | "runtime" | "fingerprint" | "inspect" | "transcode" | "validate" | "finalize";
  status: "running" | "cancelling" | "completed" | "cancelled" | "failed";
};
export async function getMediaPreparation(requestId: string): Promise<MediaPreparationProgress | null> {
  return invoke("get_media_preparation", { requestId });
}
export async function cancelMediaPreparation(requestId: string): Promise<boolean> {
  return invoke("cancel_media_preparation", { requestId });
}
