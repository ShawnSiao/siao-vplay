import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type Ref,
} from "react";

import type { SubtitleVersion } from "../../types";
import {
  formatTranscriptTime,
  type TranscriptCue,
} from "./subtitleTranscriptModel";
import { useSubtitleTranscript } from "./useSubtitleTranscript";
import "./SubtitleTranscriptPanel.css";

type SubtitleTranscriptPanelProps = {
  originalVersion: SubtitleVersion | null;
  translatedVersion: SubtitleVersion | null;
  positionMs: number;
  onPause: () => void;
  onSeekTo: (positionMs: number) => void;
};

const virtualizeAt = 500;
const virtualRowHeight = 112;
const virtualOverscan = 6;

type TranscriptCueButtonProps = {
  cue: TranscriptCue;
  current: boolean;
  originalLanguage?: string;
  buttonRef?: Ref<HTMLButtonElement>;
  style?: CSSProperties;
  onActivate: () => void;
};

function TranscriptCueButton({
  cue,
  current,
  originalLanguage,
  buttonRef,
  style,
  onActivate,
}: TranscriptCueButtonProps) {
  return (
    <button
      ref={buttonRef}
      aria-current={current ? "true" : undefined}
      className="transcript-cue"
      style={style}
      type="button"
      onClick={onActivate}
    >
      <time dateTime={`PT${Math.floor(cue.startMs / 1_000)}S`}>
        {formatTranscriptTime(cue.startMs)}
      </time>
      <span className="transcript-cue-copy">
        {cue.originalText ? <span lang={originalLanguage}>{cue.originalText}</span> : null}
        {cue.translatedText ? (
          <strong lang="zh-CN">{cue.translatedText}</strong>
        ) : cue.originalText ? (
          <small>暂无译文</small>
        ) : null}
      </span>
    </button>
  );
}

export function SubtitleTranscriptPanel({
  originalVersion,
  translatedVersion,
  positionMs,
  onPause,
  onSeekTo,
}: SubtitleTranscriptPanelProps) {
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const currentRowRef = useRef<HTMLButtonElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(480);
  const {
    cues,
    visibleCues,
    currentCueKey,
    query,
    scope,
    following,
    setQuery,
    setScope,
    pauseFollowing,
    resumeFollowing,
  } = useSubtitleTranscript({
    originalVersion,
    translatedVersion,
    positionMs,
  });
  const virtualized = visibleCues.length >= virtualizeAt;
  const currentVisibleIndex = useMemo(
    () => visibleCues.findIndex((cue) => cue.key === currentCueKey),
    [currentCueKey, visibleCues],
  );
  const virtualRange = useMemo(() => {
    if (!virtualized) return { start: 0, end: visibleCues.length };
    const start = Math.max(
      0,
      Math.floor(scrollTop / virtualRowHeight) - virtualOverscan,
    );
    const end = Math.min(
      visibleCues.length,
      Math.ceil((scrollTop + viewportHeight) / virtualRowHeight) +
        virtualOverscan,
    );
    return { start, end };
  }, [scrollTop, viewportHeight, virtualized, visibleCues.length]);

  useEffect(() => {
    const list = listRef.current;
    if (!list || typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(([entry]) => {
      setViewportHeight(entry.contentRect.height);
    });
    observer.observe(list);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!following || currentVisibleIndex < 0) return;
    if (virtualized) {
      const list = listRef.current;
      if (!list) return;
      const top = Math.max(
        0,
        currentVisibleIndex * virtualRowHeight -
          Math.max(0, list.clientHeight - virtualRowHeight) / 2,
      );
      if (typeof list.scrollTo === "function") list.scrollTo({ top });
      else list.scrollTop = top;
      return;
    }
    currentRowRef.current?.scrollIntoView?.({ block: "center" });
  }, [currentCueKey, currentVisibleIndex, following, virtualized]);

  useEffect(() => {
    const focusSearch = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.key.toLowerCase() === "f") {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", focusSearch);
    return () => window.removeEventListener("keydown", focusSearch);
  }, []);

  const markKeyboardScroll = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (["PageDown", "PageUp", "Home", "End", "ArrowDown", "ArrowUp"].includes(event.key)) {
      pauseFollowing();
    }
  };
  const activateCue = (cue: TranscriptCue) => {
    onPause();
    onSeekTo(cue.startMs);
  };
  const renderedCues = virtualized
    ? visibleCues.slice(virtualRange.start, virtualRange.end)
    : visibleCues;

  return (
    <section className="subtitle-transcript-panel" aria-label="同步逐字稿">
      <div className="transcript-tools">
        <label className="transcript-search">
          <span aria-hidden="true">⌕</span>
          <input
            ref={searchRef}
            aria-label="搜索逐字稿"
            type="search"
            value={query}
            placeholder="搜索原文、译文或时间"
            onChange={(event) => setQuery(event.target.value)}
          />
          <kbd>Ctrl+F</kbd>
        </label>
        <div className="transcript-scope" role="group" aria-label="逐字稿范围">
          <button
            aria-pressed={scope === "nearby"}
            type="button"
            onClick={() => setScope("nearby")}
          >
            当前及之前
          </button>
          <button
            aria-pressed={scope === "all"}
            type="button"
            onClick={() => setScope("all")}
          >
            全部字幕（含后续剧情）
          </button>
        </div>
      </div>

      {!following ? (
        <div className="transcript-follow-paused" role="status">
          <span>已暂停自动跟随</span>
          <button type="button" onClick={resumeFollowing}>回到当前句</button>
        </div>
      ) : null}

      <div
        ref={listRef}
        aria-label="字幕列表"
        className="transcript-list"
        role="region"
        tabIndex={0}
        onKeyDown={markKeyboardScroll}
        onPointerDown={(event) => {
          if (event.target === event.currentTarget) pauseFollowing();
        }}
        onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
        onTouchMove={pauseFollowing}
        onWheel={pauseFollowing}
      >
        {cues.length === 0 ? (
          <div className="transcript-empty">
            <strong>暂无可浏览的字幕</strong>
            <span>导入或生成原文字幕后，逐字稿会在这里按时间显示。</span>
          </div>
        ) : visibleCues.length === 0 ? (
          <div className="transcript-empty">
            <strong>{!query.trim() && scope === "nearby" ? "尚未播放到字幕" : "没有匹配内容"}</strong>
            <span>{!query.trim() && scope === "nearby" ? "播放后显示当前及之前的字幕；全部字幕包含后续剧情。" : "可以搜索原文、译文或 02:37 这样的时间。"}</span>
          </div>
        ) : (
          <div
            className={`transcript-list-inner${virtualized ? " virtualized" : ""}`}
            style={virtualized ? { height: visibleCues.length * virtualRowHeight } : undefined}
          >
            {renderedCues.map((cue, renderedIndex) => {
              const cueIndex = virtualized
                ? virtualRange.start + renderedIndex
                : renderedIndex;
              const current = cue.key === currentCueKey;
              return (
                <TranscriptCueButton
                  key={cue.key}
                  cue={cue}
                  current={current}
                  originalLanguage={originalVersion?.languageCode}
                  buttonRef={!virtualized && current ? currentRowRef : undefined}
                  style={virtualized ? {
                    position: "absolute",
                    top: cueIndex * virtualRowHeight,
                    height: virtualRowHeight,
                  } : undefined}
                  onActivate={() => activateCue(cue)}
                />
              );
            })}
          </div>
        )}
      </div>

      <footer className="transcript-footer">
        <button
          type="button"
          disabled={currentCueKey === null}
          onClick={resumeFollowing}
        >
          ⌁ 回到当前句
        </button>
      </footer>
    </section>
  );
}
