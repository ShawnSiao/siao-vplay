import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { commandError } from "../../lib/desktop";
import { readPreference } from "../../lib/preferenceRecord";
import { savePreference } from "../../lib/preferenceNotice";
import { speechPreference } from "./speechPreferences";
import { listSpeechVoices, synthesizeSpeech } from "./speechDesktop";
import type {
  SpeechPlaybackState,
  SpeechVoice,
} from "./speechTypes";
import { preferredVoice, speechPackLabel, voicesForLanguage } from "./voiceMatching";

type LocalSpeechOptions = {
  language: string;
  onBeforeSpeak: () => void;
};

export type LocalSpeechController = {
  voices: SpeechVoice[];
  matchingVoices: SpeechVoice[];
  selectedVoiceId: string | null;
  state: SpeechPlaybackState;
  loading: boolean;
  error: string | null;
  missingVoiceMessage: string | null;
  setSelectedVoiceId: (voiceId: string) => void;
  speak: (text: string, language: string, sourceId: string) => Promise<void>;
  stop: () => void;
};

export function useLocalSpeech({
  language,
  onBeforeSpeak,
}: LocalSpeechOptions): LocalSpeechController {
  const [voices, setVoices] = useState<SpeechVoice[]>([]);
  const [state, setState] = useState<SpeechPlaybackState>({ kind: "idle" });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [preferences, setPreferences] = useState<Record<string, string>>({});
  const generationRef = useRef(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlRef = useRef<string | null>(null);

  const releaseAudio = useCallback(() => {
    audioRef.current?.pause();
    audioRef.current = null;
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    }
  }, []);

  const stop = useCallback(() => {
    generationRef.current += 1;
    releaseAudio();
    setState({ kind: "idle" });
  }, [releaseAudio]);

  useEffect(() => {
    let active = true;
    void listSpeechVoices()
      .then((installed) => {
        if (active) {
          setVoices(installed);
        }
      })
      .catch((cause: unknown) => {
        if (active) {
          setError(commandError(cause).message);
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });
    return () => {
      active = false;
      generationRef.current += 1;
      releaseAudio();
    };
  }, [releaseAudio]);

  const matchingVoices = useMemo(
    () => voicesForLanguage(voices, language),
    [language, voices],
  );
  const preferredId = useMemo(
    () => preferences[language.toLowerCase()] ?? readPreference(speechPreference(language)),
    [language, preferences],
  );
  const selectedVoice = preferredVoice(voices, language, preferredId);
  const selectedVoiceId = selectedVoice?.id ?? null;
  const missingVoiceMessage = !loading && !matchingVoices.length
    ? `未找到${speechPackLabel(language)}声音。请在 Windows 设置的「时间和语言 → 语言和区域」中安装对应语音包。`
    : null;

  const setSelectedVoiceId = useCallback((voiceId: string) => {
    setPreferences((current) => ({ ...current, [language.toLowerCase()]: voiceId }));
    savePreference(speechPreference(language), voiceId);
  }, [language]);

  const speak = useCallback(async (
    text: string,
    requestedLanguage: string,
    sourceId: string,
  ) => {
    const voice = preferredVoice(voices, requestedLanguage,
      preferences[requestedLanguage.toLowerCase()] ?? readPreference(speechPreference(requestedLanguage)));
    if (!voice) {
      setError(`未安装${speechPackLabel(requestedLanguage)}声音。请先安装对应的 Windows 语音包。`);
      return;
    }
    releaseAudio();
    const generation = ++generationRef.current;
    onBeforeSpeak();
    setError(null);
    setState({ kind: "synthesizing", sourceId });
    try {
      const result = await synthesizeSpeech({
        text,
        language: requestedLanguage,
        voiceId: voice.id,
      });
      if (generation !== generationRef.current) {
        return;
      }
      const url = URL.createObjectURL(new Blob([new Uint8Array(result.bytes)], {
        type: result.mimeType,
      }));
      const audio = new Audio(url);
      urlRef.current = url;
      audioRef.current = audio;
      audio.onended = () => {
        if (generation === generationRef.current) {
          releaseAudio();
          setState({ kind: "idle" });
        }
      };
      audio.onerror = () => {
        if (generation === generationRef.current) {
          releaseAudio();
          setState({ kind: "idle" });
          setError("本机已完成语音合成，但音频播放失败。可以重试或更换系统声音。");
        }
      };
      await audio.play();
      if (generation === generationRef.current) {
        setState({ kind: "playing", sourceId });
      }
    } catch (cause) {
      if (generation === generationRef.current) {
        releaseAudio();
        setState({ kind: "idle" });
        setError(commandError(cause).message);
      }
    }
  }, [onBeforeSpeak, preferences, releaseAudio, voices]);

  return {
    voices,
    matchingVoices,
    selectedVoiceId,
    state,
    loading,
    error,
    missingVoiceMessage,
    setSelectedVoiceId,
    speak,
    stop,
  };
}
