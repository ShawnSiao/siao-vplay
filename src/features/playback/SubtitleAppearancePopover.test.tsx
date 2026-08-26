import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { defaultSubtitleDisplayPreferences } from "./playbackPreferences";
import { SubtitleAppearancePopover } from "./SubtitleAppearancePopover";

describe("SubtitleAppearancePopover", () => {
  it("validates custom colors and exposes position and color resets", () => {
    const onChange = vi.fn();
    render(<SubtitleAppearancePopover preferences={defaultSubtitleDisplayPreferences} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "字幕设置" }));
    const hex = screen.getByRole("textbox", { name: "当前词颜色 HEX 值" });
    fireEvent.change(hex, { target: { value: "#123" } });
    expect(hex).toHaveAttribute("aria-invalid", "true");
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.change(hex, { target: { value: "#67E8F9" } });
    expect(onChange).toHaveBeenLastCalledWith({
      ...defaultSubtitleDisplayPreferences,
      highlightColor: "#67e8f9",
    });
    fireEvent.click(screen.getByRole("button", { name: "恢复默认位置" }));
    expect(onChange).toHaveBeenLastCalledWith({
      ...defaultSubtitleDisplayPreferences,
      position: { x: 0.5, y: 0.9 },
    });
    fireEvent.click(screen.getByRole("button", { name: "恢复默认尺寸" }));
    expect(onChange).toHaveBeenLastCalledWith({
      ...defaultSubtitleDisplayPreferences,
      frameSize: { widthRatio: null, minHeightRatio: null },
    });
  });

  it("changes and resets the two colors independently", () => {
    const onChange = vi.fn();
    render(<SubtitleAppearancePopover preferences={defaultSubtitleDisplayPreferences} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "字幕设置" }));

    fireEvent.change(screen.getByRole("textbox", { name: "字幕默认颜色 HEX 值" }), {
      target: { value: "#FEF3C7" },
    });
    expect(onChange).toHaveBeenLastCalledWith({
      ...defaultSubtitleDisplayPreferences,
      baseTextColor: "#fef3c7",
    });

    fireEvent.click(screen.getByRole("button", { name: "使用当前词颜色 #49d6e9" }));
    expect(onChange).toHaveBeenLastCalledWith({
      ...defaultSubtitleDisplayPreferences,
      highlightColor: "#49d6e9",
    });
  });
});
