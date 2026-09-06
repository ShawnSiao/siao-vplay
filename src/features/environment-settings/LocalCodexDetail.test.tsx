import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LocalCodexDetail } from "./LocalCodexDetail";
const detect = vi.hoisted(() => vi.fn());
vi.mock("../../lib/desktop", () => ({ getCodexRuntimeStatus: detect, commandError: (e: Error) => e }));
describe("Codex detection", () => {
  it("checks again on refresh and accurately describes external processing", async () => {
    detect.mockResolvedValueOnce({ available: false, errorMessage: "未安装" })
      .mockResolvedValueOnce({ available: true, supported: true, authenticated: true, version: "test" });
    const { rerender } = render(<LocalCodexDetail previewMode={false} refreshKey={0} />);
    expect(await screen.findByText("未安装")).toBeInTheDocument();
    rerender(<LocalCodexDetail previewMode={false} refreshKey={1} />);
    await waitFor(() => expect(detect).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("可以使用")).toBeInTheDocument();
    expect(screen.getByText(/不代表离线推理/)).toBeInTheDocument();
    expect(screen.queryByText(/不会把字幕或画面发送给外部/)).not.toBeInTheDocument();
  });
});
