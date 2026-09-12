import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
import { LocalCodexDetail } from "./LocalCodexDetail";
it("does not show malformed readiness as usable and recovers on refresh", async () => {
  mocks.invoke.mockResolvedValueOnce({ available: true, authenticated: true, supported: true }).mockResolvedValue({
    available: true, authenticated: true, supported: true, version: "0.100.0", minimumVersion: "0.100.0", authMode: "chatgpt", errorCode: null, errorMessage: null,
  });
  const { rerender } = render(<LocalCodexDetail previewMode={false} />);
  expect(await screen.findByText("Codex 检测结果格式不完整，请重新检测。")).toBeInTheDocument();
  expect(screen.queryByText("可以使用")).not.toBeInTheDocument();
  rerender(<LocalCodexDetail previewMode={false} refreshKey={1} />);
  expect(await screen.findByText("可以使用")).toBeInTheDocument();
  expect(screen.queryByText("Codex 检测结果格式不完整，请重新检测。")).not.toBeInTheDocument();
});
