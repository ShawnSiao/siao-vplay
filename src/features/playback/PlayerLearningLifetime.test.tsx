import { useState, type ComponentProps } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { PlayerAuxiliaryDrawer } from "./PlayerAuxiliaryDrawer";

vi.mock("../../components/LearningPanel", () => ({
  LearningPanel: function LearningFixture({ visible = true }: { visible?: boolean }) {
    const [text, setText] = useState("");
    return <input hidden={!visible} aria-label="学习输入夹具" value={text} onChange={(event) => setText(event.target.value)} />;
  },
}));

it("preserves the mounted learning session across subtitle ticks and isolates projects", () => {
  const props = { activeTab: "learn", projectId: "one", mediaTitle: "Media", contextLabel: "Line", contextStatus: "Ready", episodeSummary: "",
    originalVersion: null, translatedVersion: null, activeOriginal: { id: "line-1" }, activeTranslation: null,
    episodeNavigation: {}, switchingEpisode: false, positionMs: 1000, durationMs: 10000,
    onSelectTab: vi.fn(), onClose: vi.fn(), onSwitchEpisode: vi.fn(), onManageSubtitles: vi.fn(), onSeekTo: vi.fn(), onPausePlayback: vi.fn(),
  } as unknown as ComponentProps<typeof PlayerAuxiliaryDrawer>;
  const { rerender } = render(<PlayerAuxiliaryDrawer {...props} />);
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "unfinished draft" } });
  rerender(<PlayerAuxiliaryDrawer {...props} activeOriginal={{ ...props.activeOriginal!, id: "line-2" }} positionMs={5000} />);
  expect(screen.getByRole("textbox")).toHaveValue("unfinished draft");
  rerender(<PlayerAuxiliaryDrawer {...props} activeTab="transcript" />);
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  rerender(<PlayerAuxiliaryDrawer {...props} />);
  expect(screen.getByRole("textbox")).toHaveValue("unfinished draft");
  rerender(<PlayerAuxiliaryDrawer {...props} activeTab={null} />);
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  rerender(<PlayerAuxiliaryDrawer {...props} />);
  expect(screen.getByRole("textbox")).toHaveValue("unfinished draft");
  rerender(<PlayerAuxiliaryDrawer {...props} projectId="two" />);
  expect(screen.getByRole("textbox")).toHaveValue("");
});
