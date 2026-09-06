import { getSubtitleVersion } from "../../lib/desktop";
import type { LearningTask, SubtitleVersion } from "../../types";
import type { LearningContext } from "./learningContext";

export async function readLearningTaskContext(task: LearningTask, current: LearningContext): Promise<LearningContext> {
  if (task.projectId !== current.projectId) throw new Error("学习记录不属于当前视频。");
  const readVersion = async (id: string, role: SubtitleVersion["role"]) => {
    const cached = role === "original" ? current.sourceVersion : current.translationVersion;
    const version = cached?.id === id ? cached : await getSubtitleVersion(task.projectId, id);
    if (version.id !== id || version.projectId !== task.projectId || version.role !== role) {
      throw new Error("学习记录的字幕版本不匹配。");
    }
    return version;
  };
  const [sourceVersion, translationVersion] = await Promise.all([
    readVersion(task.sourceVersionId, "original"),
    task.translationVersionId ? readVersion(task.translationVersionId, "translation") : null,
  ]);
  const sourceSegment = sourceVersion.segments.find((segment) => segment.id === task.sourceSegmentId);
  if (!sourceSegment || !task.selectedText.trim() || !sourceSegment.text.includes(task.selectedText.trim()) ||
      !Number.isFinite(task.playbackPositionMs) || task.playbackPositionMs < sourceSegment.startMs) {
    throw new Error("学习记录的原文或播放范围不匹配。");
  }
  return {
    projectId: task.projectId, playbackPositionMs: task.playbackPositionMs, sourceVersion, translationVersion, sourceSegment,
    translationSegment: translationVersion?.segments.find((segment) => segment.sourceSegmentId === sourceSegment.id) ?? null,
  };
}
