import { beforeEach, expect, it, vi } from "vitest";
import { createLearningCard, getLearningCard, listLearningCards, deleteLearningCard, exportLearningCards } from "./desktop";
const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
beforeEach(() => mocks.invoke.mockReset());
const card = { id:"card", projectId:"project", dictionaryEntryId:"entry", sourceVersionId:"source", translationVersionId:null, sourceSegmentId:"segment", selectedText:"word", selectionKind:"word", pronunciation:"", partOfSpeech:"", contextualMeaning:"meaning", usageNote:null, sourceSentence:"word", translatedSentence:null, languageCode:"en", playbackPositionMs:0, screenshotPath:"W:/card.jpg", screenshotSha256:"a".repeat(64), screenshotAvailable:false, createdAtMs:1, updatedAtMs:1 };
const operations = {
  create: () => createLearningCard("project", "entry"), get: () => getLearningCard("card"), list: () => listLearningCards("project"),
  remove: () => deleteLearningCard("project", "card"), export: () => exportLearningCards("project", "W:/exports"),
};
it.each([
  ["create", {...card, projectId:"other"}], ["create", {...card, dictionaryEntryId:"other"}], ["get", {...card, id:"other"}],
  ["get", {...card, screenshotAvailable:"false"}], ["get", {...card, playbackPositionMs:-1}], ["get", {...card, selectionKind:"unknown"}],
  ["get", {...card, screenshotSha256:"bad"}], ["get", null], ["list", [card, card]], ["list", [{...card, projectId:"other"}]],
  ["list", {}], ["remove", "false"], ["export", {directory:"W:/exports", jsonPath:"", markdownPath:"file.md", cardCount:1}],
  ["export", {directory:"W:/exports", jsonPath:"file.json", markdownPath:"file.md", cardCount:-1}],
] as const)("rejects malformed or unrelated %s result", async (operation, value) => {
  mocks.invoke.mockResolvedValue(value);
  await expect(operations[operation]()).rejects.toThrow();
});
it("accepts retained cards without a dictionary entry or available screenshot", async () => {
  const retained = {...card, dictionaryEntryId:null};
  mocks.invoke.mockResolvedValue(retained);
  await expect(operations.get()).resolves.toEqual(retained);
  mocks.invoke.mockResolvedValue([retained]);
  await expect(operations.list()).resolves.toEqual([retained]);
});
it.each([true, false])("retains boolean deletion response %s", async value => {
  mocks.invoke.mockResolvedValue(value);
  await expect(operations.remove()).resolves.toBe(value);
});
