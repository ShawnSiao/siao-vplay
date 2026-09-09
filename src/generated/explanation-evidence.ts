/* Generated from Rust IPC schema. Run npm run contracts:generate. */

export interface ExplanationEvidence {
  explanationId: string;
  /**
   * @maxItems 6
   */
  frames:
    | []
    | [FrameEvidence]
    | [FrameEvidence, FrameEvidence]
    | [FrameEvidence, FrameEvidence, FrameEvidence]
    | [FrameEvidence, FrameEvidence, FrameEvidence, FrameEvidence]
    | [FrameEvidence, FrameEvidence, FrameEvidence, FrameEvidence, FrameEvidence]
    | [FrameEvidence, FrameEvidence, FrameEvidence, FrameEvidence, FrameEvidence, FrameEvidence];
  playbackCutoffMs: number;
  projectId: string;
  sourceVersionId: string;
  /**
   * @maxItems 40
   */
  subtitles: SubtitleEvidence[];
  taskId: string;
  [k: string]: unknown;
}
export interface FrameEvidence {
  id: string;
  timestampMs: number;
  [k: string]: unknown;
}
export interface SubtitleEvidence {
  endMs: number;
  segmentId: string;
  startMs: number;
  text: string;
  [k: string]: unknown;
}
