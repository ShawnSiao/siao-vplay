import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppErrorBoundary } from "./AppErrorBoundary";
describe("application error recovery", () => {
  afterEach(() => { vi.restoreAllMocks(); });
  it("recovers the interface without deleting saved data or exposing exception text", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    window.localStorage.setItem("saved-test-preference", "keep");
    let broken = true;
    function Screen() {
      if (broken) throw new Error("secret path and subtitle body");
      return <p>可用界面</p>;
    }
    render(<AppErrorBoundary><Screen /></AppErrorBoundary>);
    expect(screen.getByRole("alert")).toHaveTextContent("界面遇到错误");
    expect(screen.queryByText(/secret path/)).not.toBeInTheDocument();
    broken = false;
    fireEvent.click(screen.getByRole("button", { name: "重新打开界面" }));
    expect(screen.getByText("可用界面")).toBeInTheDocument();
    expect(window.localStorage.getItem("saved-test-preference")).toBe("keep");
  });
});
