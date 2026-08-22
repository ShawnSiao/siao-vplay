import type { CSSProperties } from "react";
import type { SubtitleSegment } from "../../types";
import { getTimedCaptionWords } from "./captionTiming";

type KaraokeCaptionLineProps = {
  segment: SubtitleSegment;
  positionMs: number;
  enabled: boolean;
  highlightColor: string;
  language?: string;
};

export function KaraokeCaptionLine({
  segment,
  positionMs,
  enabled,
  highlightColor,
  language,
}: KaraokeCaptionLineProps) {
  const words = enabled ? getTimedCaptionWords(segment, positionMs) : null;
  return (
    <p className="caption-line original" lang={language}>
      {words
        ? words.map((word) => {
            const style =
              word.state === "current"
                ? ({
                    "--caption-highlight": highlightColor,
                    "--caption-progress": `${Math.round(word.progress * 100)}%`,
                  } as CSSProperties)
                : undefined;
            return (
              <span
                key={`${word.ordinal}:${word.startMs}`}
                className={`caption-word ${word.state}`}
                style={style}
              >
                {word.text}
              </span>
            );
          })
        : segment.text}
    </p>
  );
}
