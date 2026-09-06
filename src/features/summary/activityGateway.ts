import { invoke } from "@tauri-apps/api/core";

export type SummaryActivity = {
  id: string;
  projectId: string;
  projectTitle: string;
  status: string;
  updatedAtMs: number;
  hasResult: boolean;
};
export async function listSummaryActivity(): Promise<SummaryActivity[]> {
  const value: unknown = await invoke("list_summary_activity");
  if (!Array.isArray(value) || !value.every((row: unknown) => {
    if (!row || typeof row !== "object") return false;
    const item = row as Record<string, unknown>;
    return [item.id, item.projectId, item.projectTitle, item.status].every((text) => typeof text === "string") &&
      typeof item.updatedAtMs === "number" && Number.isFinite(item.updatedAtMs) && typeof item.hasResult === "boolean";
  })) throw new Error("处理动态格式不完整");
  return value as SummaryActivity[];
}
