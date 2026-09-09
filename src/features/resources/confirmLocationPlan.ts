import type { LocalResourceLocationPlan, ResourceLocationResult } from "../../types";
export async function confirmLocationPlan(plan: LocalResourceLocationPlan | null, consume: () => void,
  confirm: (plan: LocalResourceLocationPlan) => Promise<ResourceLocationResult>) {
  if (!plan) throw new Error("需要先选择并核对保存位置。");
  consume();
  return confirm(plan);
}
