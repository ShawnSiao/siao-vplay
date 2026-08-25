import type { MediaDropFeedback } from "../features/shell/useDesktopMediaDrop";

type SubtitleScriptSample = {
  original: string;
  translation: string;
};

const subtitleScriptSamples: Record<string, SubtitleScriptSample> = {
  thai: {
    original: "เมื่อเราออกแบบระบบความจำระยะยาว เราต้องแยกข้อมูลที่ยืนยันได้ออกจากข้อสันนิษฐานอย่างชัดเจน",
    translation: "设计长期记忆系统时，需要明确区分可验证的信息与推测。",
  },
  japanese: {
    original: "長期記憶の仕組みを設計するときは、確認できる事実と推測を明確に分ける必要があります。",
    translation: "设计长期记忆机制时，需要明确区分可确认的事实与推测。",
  },
  korean: {
    original: "장기 기억 시스템을 설계할 때는 확인 가능한 사실과 추론을 명확하게 구분해야 합니다.",
    translation: "设计长期记忆系统时，需要明确区分可确认的事实与推断。",
  },
};

export function configurePlayerHarnessValidation() {
  const parameters = new URLSearchParams(window.location.search);
  const background = parameters.get("captionBackground");
  if (["light", "complex", "dark"].includes(background ?? "")) {
    document.documentElement.dataset.captionValidationBackground = background ?? "";
  }
  return subtitleScriptSamples[parameters.get("subtitleScript") ?? ""];
}

export function requestedDropFeedback(): MediaDropFeedback | null {
  const drop = new URLSearchParams(window.location.search).get("drop");
  return drop === "ready"
    ? { tone: "ready", message: "松开以导入这个视频" }
    : null;
}
