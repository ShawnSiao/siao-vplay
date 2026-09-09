import { act, fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { ExternalResultNotice } from "./ExternalResultNotice";
it("keeps manual recovery disabled while the shared check is running", async () => {
  let finish!: () => void;
  const retry = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
  const { rerender } = render(<ExternalResultNotice failure="scan" onRetry={retry} />);
  const button = screen.getByRole("button", { name: "重新检查外部结果" });
  fireEvent.click(button);
  expect(button).toBeDisabled();
  expect(button).toHaveTextContent("正在检查…");
  fireEvent.click(button);
  expect(retry).toHaveBeenCalledTimes(1);
  await act(async () => finish());
  expect(button).toBeEnabled();
  rerender(<ExternalResultNotice failure={null} onRetry={retry} />);
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
});
