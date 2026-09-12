import { expect, it } from "vitest";
import { adoptionFeedback } from "./adoptionFeedback";
import { resourceAdoptionResult } from "../../test-fixtures/resourceAdoption";
it("distinguishes completed, uncertain and unattempted resources", () => {
  const feedback = adoptionFeedback({ ...resourceAdoptionResult, alreadyActiveResourceIds: ["ready"], interruption: { resourceId: "uncertain", message: "请检查安装记录。", unattemptedResourceIds: ["later"] } });
  expect(feedback.notice).toContain("已接管 1 项，1 项无需重复接管");
  expect(feedback.error).toContain("已确认 2 项"); expect(feedback.error).toContain("当前资源未确认完成，1 项尚未尝试");
});
it("does not label rejected preview candidates as interrupted installation", () => {
  const feedback = adoptionFeedback({ ...resourceAdoptionResult, rejectedResourceIds: ["invalid"] });
  expect(feedback.error).toContain("候选未通过验证"); expect(feedback.error).not.toContain("接管中断");
});
