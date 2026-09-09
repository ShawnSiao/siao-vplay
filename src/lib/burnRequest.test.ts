import { expect, it } from "vitest";
import { parseBurnRequest } from "./burnRequest";
const input = { projectId: "p", mode: "translation", sourceVersionId: null, translationVersionId: "t",
  destinationDirectory: "fixture", style: { textSize: "medium", positionY: 0.9 }, confirmVersionSelection: true };
it.each(["small", "medium", "large"])("accepts supported size %s and normalized endpoints", textSize => {
  for (const positionY of [0, 0.9, 1]) {
    const value = { ...input, style: { textSize, positionY } };
    expect(parseBurnRequest(value)).toEqual(value);
  }
});
it.each([{ confirmVersionSelection: false }, { mode: "bilingual" }, { sourceVersionId: " " },
  { style: { textSize: "huge", positionY: 0.9 } }, { style: null }, { mode: "unknown" }])("rejects invalid material or confirmation %j", patch => {
  expect(() => parseBurnRequest({ ...input, ...patch })).toThrow();
});
it("accepts explicit bilingual source and retains the exact selected values", () => {
  const value = { ...input, mode: "bilingual", sourceVersionId: "source" };
  expect(parseBurnRequest(value)).toEqual(value);
});
