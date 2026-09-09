import { invoke } from "@tauri-apps/api/core";
import type { Project } from "../generated/project";
import validate from "../generated/project.validator.mjs";

type ProjectCommand = "get_project" | "open_local_project" | "create_local_project" | "import_remote_media_url"
  | "mark_project_opened" | "ensure_project_poster" | "update_playback_state" | "relink_project_media"
  | "import_youtube_url" | "set_project_watched";

export async function invokeProject(command: ProjectCommand, args: Record<string, unknown>): Promise<Project> {
  const input = args.input;
  const requestedId = args.projectId ?? (input && typeof input === "object" && "projectId" in input ? input.projectId : undefined);
  const value: unknown = await invoke(command, args);
  if (!validate(value) || !value.id.trim() || !value.mediaSource.id.trim() || !value.mediaSource.locator.trim()
    || (requestedId !== undefined && value.id !== requestedId)) {
    throw new Error("项目数据无效或与当前视频不一致，请重新打开视频");
  }
  return value;
}
