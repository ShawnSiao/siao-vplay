import type { ResourceAdoptionResult } from "../../types";
export function adoptionFeedback(result: ResourceAdoptionResult) {
  const adopted = result.adoptedResourceIds.length, active = result.alreadyActiveResourceIds.length;
  if (result.interruption) return {
    notice: `接管已停止，已接管 ${adopted} 项，${active} 项无需重复接管。`,
    error: `接管中断：已确认 ${adopted + active} 项；当前资源未确认完成，${result.interruption.unattemptedResourceIds.length} 项尚未尝试。${result.interruption.message} 请重新检查现有资源和资源状态后再继续。`,
  };
  const rejected = result.rejectedResourceIds.length;
  return {
    notice: rejected > 0 ? `已接管 ${adopted} 项资源，${rejected} 项候选未通过验证。` : adopted > 0 ? `已接管 ${adopted} 项本地功能资源，无需重复下载。` : "没有需要接管的新资源。",
    error: rejected > 0 ? `有 ${rejected} 项候选未通过验证，请重新检查候选及资源状态。` : null,
  };
}
