import { act, renderHook, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { createUnderstandingFixtures } from "../../test-fixtures/understanding";
import { useExplanationEvidence } from "./useExplanationEvidence";
const read = vi.hoisted(() => vi.fn());
vi.mock("./explanationEvidence", () => ({ readExplanationEvidence: read }));
const { explanation } = createUnderstandingFixtures({ projectId: "p", sourceVersionId: "s", translationVersionId: "t", sourceSegmentId: "line" });
it("ignores late evidence after switching results and can retry the current result", async () => {
  let finish!: (value: unknown) => void;
  read.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }))
    .mockRejectedValueOnce(new Error("missing" )).mockResolvedValueOnce({ explanationId: "next" });
  const { result, rerender } = renderHook(({ value }) => useExplanationEvidence(value), { initialProps: { value: explanation } });
  rerender({ value: { ...explanation, id: "next" } });
  await waitFor(() => expect(result.current.failed).toBe(true));
  await act(async () => { finish({ explanationId: explanation.id }); });
  expect(result.current.data).toBeNull();
  act(() => result.current.retry());
  await waitFor(() => expect(result.current.data).toEqual({ explanationId: "next" }));
});
