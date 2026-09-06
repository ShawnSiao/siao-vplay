import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { createUnderstandingFixtures } from "../../test-fixtures/understanding";
import { UnderstandingResultView } from "./UnderstandingResultView";

const { explanation } = createUnderstandingFixtures({ projectId: "project", sourceVersionId: "source", translationVersionId: "translation", sourceSegmentId: "segment-with-internal-id" });
it("shows the verified original sentence and jumps to its timestamp", () => {
  const jump = vi.fn();
  render(<UnderstandingResultView explanation={explanation} factsExpanded={false} interpretationsExpanded={false}
    onFactsExpandedChange={vi.fn()} onInterpretationsExpandedChange={vi.fn()} onAnalyzeAgain={vi.fn()}
    evidence={{ explanationId: explanation.id, projectId: "project", taskId: explanation.taskId, sourceVersionId: "source", playbackCutoffMs: 42000,
      subtitles: [{ segmentId: "segment-with-internal-id", startMs: 2000, endMs: 3000, text: "駅の前で会おう。" }], frames: [{ id: explanation.possibleInterpretations[0].frameIds[0], timestampMs: 41750 }] }} onJump={jump} />);
  expect(screen.getAllByText("駅の前で会おう。")).toHaveLength(2);
  fireEvent.click(screen.getAllByRole("button", { name: "定位原文 00:02" })[0]);
  expect(jump).toHaveBeenCalledWith(2000);
  expect(screen.queryByText(/segment-/)).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "定位画面 00:41" })).toBeInTheDocument();
});
