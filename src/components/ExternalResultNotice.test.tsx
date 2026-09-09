import { act, fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { ExternalResultNotice } from "./ExternalResultNotice";
it("keeps manual recovery disabled while the shared check is running", async () => {
  let finish!: () => void;
  const retry = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
  const { rerender } = render(<ExternalResultNotice slowPhase={null} failure="scan" onRetry={retry} />);
  const button = screen.getByRole("button", { name: "重新检查外部结果" });
  fireEvent.click(button);
  expect(button).toBeDisabled();
  expect(button).toHaveTextContent("正在检查…");
  fireEvent.click(button);
  expect(retry).toHaveBeenCalledTimes(1);
  await act(async () => finish());
  expect(button).toBeEnabled();
  rerender(<ExternalResultNotice slowPhase={null} failure={null} onRetry={retry} />);
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
});

it("describes a slow operation as still running and prevents a replacement request", () => {
  const retry = vi.fn(async () => undefined);
  render(<ExternalResultNotice failure={null} slowPhase="scan" onRetry={retry} />);
  expect(screen.getByRole("status")).toHaveTextContent("仍在等待响应");
  const button = screen.getByRole("button", { name: "外部结果仍在等待响应" });
  expect(button).toBeDisabled();
  fireEvent.click(button);
  expect(retry).not.toHaveBeenCalled();
});
