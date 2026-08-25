import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CaptionQuickToolbar, CaptionsOffNotice } from "./CaptionQuickToolbar";

function renderToolbar(mode: "translation" | "original" | "bilingual") {
  const onChangeMode = vi.fn();
  const onChangeSize = vi.fn();
  const onToggleTranscript = vi.fn();
  const onHideCaptions = vi.fn();
  render(
    <CaptionQuickToolbar
      mode={mode}
      size="medium"
      targetLabel="中文"
      originalAvailable
      translationAvailable
      transcriptOpen={false}
      visible
      onChangeMode={onChangeMode}
      onChangeSize={onChangeSize}
      onToggleTranscript={onToggleTranscript}
      onHideCaptions={onHideCaptions}
    />,
  );
  return { onChangeMode, onChangeSize, onToggleTranscript, onHideCaptions };
}

describe("CaptionQuickToolbar", () => {
  it.each([
    ["bilingual", "隐藏原文", "translation"],
    ["translation", "显示原文", "bilingual"],
    ["original", "显示译文", "bilingual"],
  ] as const)("maps %s source toggles consistently", (mode, label, result) => {
    const { onChangeMode } = renderToolbar(mode);
    fireEvent.click(screen.getByRole("button", { name: label }));
    expect(onChangeMode).toHaveBeenCalledWith(result);
  });

  it("emits size, transcript and temporary-close actions", () => {
    const callbacks = renderToolbar("bilingual");
    fireEvent.change(screen.getByRole("combobox", { name: "字幕字号" }), {
      target: { value: "large" },
    });
    fireEvent.click(screen.getByRole("button", { name: "展开字幕" }));
    fireEvent.click(screen.getByRole("button", { name: "关闭字幕" }));
    expect(callbacks.onChangeSize).toHaveBeenCalledWith("large");
    expect(callbacks.onToggleTranscript).toHaveBeenCalledOnce();
    expect(callbacks.onHideCaptions).toHaveBeenCalledOnce();
  });

  it("offers an explicit restore entry after captions are hidden", () => {
    const onRestore = vi.fn();
    render(<CaptionsOffNotice onRestore={onRestore} />);
    fireEvent.click(screen.getByRole("button", { name: "重新显示字幕" }));
    expect(onRestore).toHaveBeenCalledOnce();
  });
});
