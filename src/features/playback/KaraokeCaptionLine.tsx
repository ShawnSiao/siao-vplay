import type { CSSProperties } from "react";
import type { SubtitleSegment } from "../../types";
import { getTimedCaptionFragments } from "./captionTiming";

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
  const fragments = enabled ? getTimedCaptionFragments(segment, positionMs) : null;
  return (
    <p className="caption-line original" lang={language}>
      {fragments
        ? fragments.map((fragment) => {
            if (fragment.kind === "plain") return <span key={fragment.key}>{fragment.text}</span>;
            const { word } = fragment;
            const style =
              word.state === "current"
                ? ({
                    "--caption-highlight": highlightColor,
                    "--caption-progress": `${Math.round(word.progress * 100)}%`,
                  } as CSSProperties)
                : undefined;
            return (
              <span
                key={fragment.key}
                className={`caption-word ${word.state}`}
                style={style}
              >
                {fragment.text}
              </span>
            );
          })
        : segment.text}
    </p>
  );
}
