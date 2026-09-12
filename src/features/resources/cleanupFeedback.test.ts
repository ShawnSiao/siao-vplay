import { expect, it } from "vitest";
import { cleanupFeedback } from "./cleanupFeedback";
it.each(["unused", "old"] as const)("reports completed and interrupted %s cleanup accurately", kind => {
  expect(cleanupFeedback(["a"], ["a"], null, kind).interrupted).toBe(false);
  const feedback = cleanupFeedback(["a", "b"], ["a"], { itemId: "b", message: "locked", remainingItemIds: ["b"] }, kind);
  expect(feedback.interrupted).toBe(true); expect(feedback.message).toContain("已完成 1 项，1 项尚未确认完成"); expect(feedback.message).toContain("重新检查清单");
});
it("rejects an acknowledgement outside the reviewed plan before showing success", () => {
  expect(() => cleanupFeedback(["a"], ["other"], null, "old")).toThrow();
});
