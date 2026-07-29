import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import App from "./App";

describe("App", () => {
  it("shows the Phase 1 local-first foundation", async () => {
    render(<App />);

    expect(
      screen.getByRole("heading", {
        name: "从一段视频开始，安静地看懂它。",
      }),
    ).toBeInTheDocument();
    expect(await screen.findByText("Core 已连接")).toBeInTheDocument();
    expect(screen.getByText("browser-preview")).toBeInTheDocument();
  });
});
