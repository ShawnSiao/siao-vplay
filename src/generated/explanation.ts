/* Generated from Rust IPC schema. Run npm run contracts:generate. */

export interface Explanation {
  confirmedFacts: ExplanationEntry[];
  createdAtMs: number;
  id: string;
  materialSummary: ExplanationMaterialSummary;
  playbackCutoffMs: number;
  possibleInterpretations: ExplanationEntry[];
  projectId: string;
  protocolVersion: string;
  sceneStartMs: number;
  sourceVersionId: string;
  taskId: string;
  translationVersionId: string | null;
  withheldReason: string | null;
  [k: string]: unknown;
}
export interface ExplanationEntry {
  frameIds: string[];
  subtitleSegmentIds: string[];
  text: string;
  [k: string]: unknown;
}
export interface ExplanationMaterialSummary {
  endMs: number;
  frameCount: number;
  startMs: number;
  subtitleCount: number;
  [k: string]: unknown;
}
