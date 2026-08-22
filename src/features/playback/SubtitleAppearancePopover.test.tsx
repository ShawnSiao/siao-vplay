import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { defaultSubtitleFollowPreferences } from "./playbackPreferences";
import { SubtitleAppearancePopover } from "./SubtitleAppearancePopover";

describe("SubtitleAppearancePopover", () => {
  it("validates custom colors and exposes position and color resets", () => {
    const onChange = vi.fn();
    render(<SubtitleAppearancePopover preferences={defaultSubtitleFollowPreferences} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "字幕设置" }));
    const hex = screen.getByRole("textbox", { name: "高亮色 HEX 值" });
    fireEvent.change(hex, { target: { value: "#123" } });
    expect(hex).toHaveAttribute("aria-invalid", "true");
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.change(hex, { target: { value: "#67E8F9" } });
    expect(onChange).toHaveBeenLastCalledWith({
      ...defaultSubtitleFollowPreferences,
      highlightColor: "#67e8f9",
    });
    fireEvent.click(screen.getByRole("button", { name: "恢复默认位置" }));
    expect(onChange).toHaveBeenLastCalledWith({
      ...defaultSubtitleFollowPreferences,
      position: { x: 0.5, y: 0.9 },
    });
  });
});
