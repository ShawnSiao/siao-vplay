import type { LearningSelectionKind } from "../../types";

export type SelectablePart = {
  text: string;
  selectable: boolean;
};

export function splitForSelection(
  text: string,
  languageCode: string,
): SelectablePart[] {
  if (!text) {
    return [];
  }
  try {
    const segmenter = new Intl.Segmenter(languageCode, { granularity: "word" });
    return Array.from(segmenter.segment(text), (part) => ({
      text: part.segment,
      selectable: Boolean(part.isWordLike),
    }));
  } catch {
    return text.split(/(\s+|[.,!?，。！？、…]+)/u).map((part) => ({
      text: part,
      selectable: Boolean(part.trim()) && !/^[.,!?，。！？、…]+$/u.test(part),
    }));
  }
}

export function selectionKind(
  selectedText: string,
  sourceSentence: string,
  selectableParts: SelectablePart[],
): LearningSelectionKind {
  if (selectedText === sourceSentence) {
    return "sentence";
  }
  if (selectableParts.some((part) => part.selectable && part.text === selectedText)) {
    return "word";
  }
  return "phrase";
}
