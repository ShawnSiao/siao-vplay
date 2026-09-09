import { invoke } from "@tauri-apps/api/core";
import type { Project } from "../generated/project";
import validate from "../generated/project.validator.mjs";

export async function readProjectList(): Promise<Project[]> {
  const value: unknown = await invoke("list_projects");
  if (!Array.isArray(value) || !value.every(isProject)
    || new Set(value.map(project => project.id)).size !== value.length) {
    throw new Error("项目列表数据无效，请重新加载");
  }
  return value;
}

function isProject(value: unknown): value is Project {
  return validate(value) && !!value.id.trim() && !!value.mediaSource.id.trim() && !!value.mediaSource.locator.trim();
}

type ProjectCommand = "get_project" | "open_local_project" | "create_local_project" | "import_remote_media_url"
  | "mark_project_opened" | "ensure_project_poster" | "update_playback_state" | "relink_project_media"
  | "import_youtube_url" | "set_project_watched";

export async function invokeProject(command: ProjectCommand, args: Record<string, unknown>): Promise<Project> {
  const input = args.input;
  const requestedId = args.projectId ?? (input && typeof input === "object" && "projectId" in input ? input.projectId : undefined);
  const value: unknown = await invoke(command, args);
  if (!isProject(value)
    || (requestedId !== undefined && value.id !== requestedId)) {
    throw new Error("项目数据无效或与当前视频不一致，请重新打开视频");
  }
  return value;
}
