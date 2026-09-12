import { expect, it } from "vitest";
import { networkSourceLabel } from "./localResourcePresentation";
it("does not label an unknown network state as direct", () => {
  expect(networkSourceLabel(undefined)).toBe("网络状态未确认");
  expect(networkSourceLabel("direct")).toBe("当前直连");
});
