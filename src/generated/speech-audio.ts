/* Generated from Rust IPC schema. Run npm run contracts:generate. */

export interface SpeechAudio {
  /**
   * @minItems 1
   * @maxItems 16777216
   */
  bytes: [number, ...number[]];
  language: string;
  mimeType: string;
  voiceId: string;
  [k: string]: unknown;
}
