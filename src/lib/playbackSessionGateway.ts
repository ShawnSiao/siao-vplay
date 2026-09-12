import { invoke } from "@tauri-apps/api/core";

export async function beginPlaybackSession(projectId: string): Promise<string> {
  const token: unknown = await invoke("begin_playback_session", { projectId });
  if (typeof token !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(token)) {
    throw new Error("播放保存会话数据无效，请重新打开视频");
  }
  return token;
}
