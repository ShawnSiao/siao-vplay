import type { LocalSpeechController } from "./useLocalSpeech";

type SpeechButtonProps = {
  controller: LocalSpeechController;
  text: string;
  language: string;
  sourceId: string;
  label: string;
  disabled?: boolean;
};

export function SpeechButton({
  controller,
  text,
  language,
  sourceId,
  label,
  disabled = false,
}: SpeechButtonProps) {
  const active = controller.state.kind !== "idle"
    && controller.state.sourceId === sourceId;
  return (
    <button
      aria-label={label}
      className={`learning-speech-button ${active ? "active" : ""}`}
      type="button"
      disabled={disabled || !text.trim() || controller.loading}
      onClick={() => void controller.speak(text, language, sourceId)}
    >
      <span aria-hidden="true">{active ? "■" : "▶"}</span>
      {active ? "停止旧朗读并重播" : "朗读"}
    </button>
  );
}
