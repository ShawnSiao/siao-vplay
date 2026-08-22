import type { SubtitleSegment } from "../../types";

type PlayerCaptionStackProps = {
  mode: "translation" | "original" | "bilingual";
  original: SubtitleSegment | null;
  translation: SubtitleSegment | null;
  originalLanguage?: string;
};

export function PlayerCaptionStack({
  mode,
  original,
  translation,
  originalLanguage,
}: PlayerCaptionStackProps) {
  if (!original && !translation) return null;

  return (
    <div className="caption-stack" aria-live="off">
      {(mode === "original" || mode === "bilingual") && original ? (
        <p className="caption-line original" lang={originalLanguage}>
          {original.text}
        </p>
      ) : null}
      {(mode === "translation" || mode === "bilingual") && translation ? (
        <p className="caption-line translation" lang="zh-CN">
          {translation.text}
        </p>
      ) : null}
    </div>
  );
}
