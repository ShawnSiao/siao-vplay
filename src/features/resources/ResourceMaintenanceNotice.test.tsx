import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { ResourceMaintenanceNotice } from "./ResourceMaintenanceNotice";
const base = { transactionState: "none", scanState: "complete", stagingReviewCount: 0, receiptRecoveryCopyCount: 0 } as const;
it("shows a pending change and preserves unknown ownership without offering deletion", () => {
  render(<ResourceMaintenanceNotice diagnostic={{ ...base, transactionState: "activation_pending", stagingReviewCount: 2, receiptRecoveryCopyCount: 1 }} />);
  expect(screen.getByText(/尚未完成的资源变更记录/)).toBeVisible();
  expect(screen.getByText(/尚未确认归属/)).toHaveTextContent("2 项暂存备份、1 项安装记录备份");
  expect(screen.queryByRole("button")).toBeNull();
});
it("does not mistake a partial zero-count scan for a clean result", () => {
  render(<ResourceMaintenanceNotice diagnostic={{ ...base, scanState: "partial" }} />);
  expect(screen.getByText(/数量仅为已检查部分/)).toBeVisible();
  expect(screen.queryByText(/未发现待处理/)).toBeNull();
});
it.each(["conflicting", "unavailable"] as const)("shows actionable %s transaction feedback", transactionState => {
  render(<ResourceMaintenanceNotice diagnostic={{ ...base, transactionState }} />);
  expect(screen.getByLabelText("资源变更与备份检查")).toHaveTextContent(transactionState === "conflicting" ? "不要手动删除或覆盖" : "不能确认变更已完成");
});
