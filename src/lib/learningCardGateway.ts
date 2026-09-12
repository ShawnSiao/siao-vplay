import { invoke } from "@tauri-apps/api/core";
import type { LearningCard } from "../types";
function invalid(): never { throw new Error("学习卡片结果无效，请刷新后重试。"); }
const nonblank = (value: string) => value.trim().length > 0;
async function readCard(value: unknown): Promise<LearningCard> {
  const { default: validate } = await import("../generated/learning-card.validator.mjs");
  if (!validate(value) || ![value.id, value.projectId, value.sourceVersionId, value.sourceSegmentId, value.languageCode, value.screenshotPath].every(nonblank) ||
      (value.dictionaryEntryId !== null && !nonblank(value.dictionaryEntryId)) ||
      (value.translationVersionId !== null && !nonblank(value.translationVersionId)) ||
      !/^[a-f0-9]{64}$/i.test(value.screenshotSha256)) invalid();
  return value;
}
export async function createLearningCard(projectId: string, dictionaryEntryId: string) {
  const value = await readCard(await invoke<unknown>("create_learning_card", { input: { projectId, dictionaryEntryId } }));
  if (value.projectId !== projectId || value.dictionaryEntryId !== dictionaryEntryId) invalid();
  return value;
}
export async function getLearningCard(cardId: string) {
  const value = await readCard(await invoke<unknown>("get_learning_card", { cardId }));
  if (value.id !== cardId) invalid();
  return value;
}
export async function listLearningCards(projectId: string) {
  const value = await invoke<unknown>("list_learning_cards", { projectId });
  if (!Array.isArray(value)) invalid();
  const cards = await Promise.all(value.map(readCard));
  if (cards.some(card => card.projectId !== projectId) || new Set(cards.map(card => card.id)).size !== cards.length) invalid();
  return cards;
}
export async function deleteLearningCard(projectId: string, cardId: string) {
  const value = await invoke<unknown>("delete_learning_card", { projectId, cardId });
  if (typeof value !== "boolean") invalid();
  return value;
}
export async function exportLearningCards(projectId: string, destinationDirectory: string) {
  const { default: validate } = await import("../generated/learning-cards-export.validator.mjs");
  const value = await invoke<unknown>("export_learning_cards", { input: { projectId, destinationDirectory } });
  if (!validate(value) || ![value.directory, value.jsonPath, value.markdownPath].every(nonblank) || value.jsonPath === value.markdownPath) invalid();
  return value;
}
