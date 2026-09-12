import { useState } from "react";
import { useTabNavigation } from "./useTabNavigation";

import { CurrentScenePanel, type CurrentScenePanelProps } from "./CurrentScenePanel";
import { VideoSummaryPanel } from "../features/summary/VideoSummaryPanel";
import "../features/summary/summary.css";
import "../features/summary/summary-results.css";

type UnderstandingPanelProps = CurrentScenePanelProps & {
  durationMs?: number | null;
  onJump?: (positionMs: number) => void;
  onPausePlayback?: () => void;
};

export function UnderstandingPanel({
  durationMs = null,
  embedded = false,
  onClose,
  onJump,
  onPausePlayback,
  ...sceneProps
}: UnderstandingPanelProps) {
  const [tab, setTab] = useState<"scene" | "summary">("scene");
  const tabs = useTabNavigation(tab, setTab);
  const PanelElement = embedded ? "section" : "aside";
  return (
    <PanelElement
      className={`understanding-shell ${embedded ? "embedded" : ""}`}
      aria-label="理解"
    >
      {!embedded ? (
        <header className="understanding-header">
          <div><span>按需理解</span><strong>场景与总结</strong></div>
          <button aria-label="关闭理解" className="understanding-close" type="button" onClick={onClose}>×</button>
        </header>
      ) : null}
      <div className="understanding-inner-tabs" {...tabs.listProps} aria-label="理解类型">
        <button
          className={tab === "scene" ? "active" : ""}
          {...tabs.tabProps("scene")}
        >
          当前场景
        </button>
        <button
          className={tab === "summary" ? "active" : ""}
          {...tabs.tabProps("summary")}
        >
          视频总结
        </button>
      </div>
      <div className="understanding-tab-content" {...tabs.panelProps}>
        {tab === "scene" ? (
          <CurrentScenePanel {...sceneProps} embedded onClose={onClose} onJump={onJump} onPausePlayback={onPausePlayback} />
        ) : (
          <VideoSummaryPanel
            projectId={sceneProps.projectId}
            playbackCutoffMs={sceneProps.playbackCutoffMs}
            durationMs={durationMs}
            sourceVersion={sceneProps.sourceVersion}
            translationVersion={sceneProps.translationVersion}
            onPrepareSubtitles={sceneProps.onPrepareSubtitles}
            onJump={onJump}
            onPausePlayback={onPausePlayback}
          />
        )}
      </div>
    </PanelElement>
  );
}
