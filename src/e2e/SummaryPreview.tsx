import { PlayerDrawer } from "../features/playback/PlayerDrawer";
import { SummaryProgress } from "../features/summary/SummaryProgress";
import { SummaryResultView } from "../features/summary/SummaryResultView";
import { createSummaryFixtures } from "../test-fixtures/summary";
import { VideoSummaryPanel } from "../features/summary/VideoSummaryPanel";
import type { SubtitleVersion } from "../types";

export function SummaryPreview({ state, sourceVersion, drawer = false }: { drawer?: boolean; state: "progress" | "result" | "confirm" | "empty"; sourceVersion: SubtitleVersion }) {
  const { task, summary } = createSummaryFixtures();
  if (new URLSearchParams(location.search).has("long-summary")) {
    summary.result.coreConcepts = Array.from({ length: 24 }, (_, index) => ({
      ...summary.result.coreConcepts[0], title: `概念 ${index + 1}`,
      body: "这是一段用于检查持续阅读、证据与操作可达性的长正文。".repeat(12),
    }));
  }
  const content = (
      <section className="understanding-shell embedded" aria-label="视频总结预览">
        <div className="understanding-inner-tabs" role="tablist" aria-label="理解类型">
          <button type="button" role="tab">当前场景</button>
          <button className="active" type="button" role="tab" aria-selected="true">视频总结</button>
        </div>
        <div className="understanding-tab-content">
          <div className="video-summary-panel">
            {state === "confirm" || state === "empty" ? <VideoSummaryPanel projectId="project-1" playbackCutoffMs={15_000}
              durationMs={120_000} sourceVersion={state === "empty" ? null : sourceVersion} translationVersion={null}
              onPrepareSubtitles={() => undefined} /> : state === "progress" ? (
              <SummaryProgress
                task={task}
                busy={false}
                onCancel={() => undefined}
                onResume={() => undefined}
                onOpenMaterials={() => undefined}
              />
            ) : (
              <SummaryResultView
                summary={summary}
                exporting={false}
                exportNotice={null}
                onExport={() => { document.documentElement.dataset.summaryAction = "export"; }}
                onNewSummary={() => { document.documentElement.dataset.summaryAction = "new"; }}
              />
            )}
          </div>
        </div>
      </section>
  );
  return drawer ? <main className="player-workspace with-drawer" style={{ height: "100vh" }}>
    <div aria-label="视频占位" />
    <PlayerDrawer activeTab="understand" mediaTitle="总结阅读测试" contextStatus="字幕已就绪"
      onClose={() => undefined} onSelectTab={() => undefined}>{content}</PlayerDrawer>
  </main> : <main className="understanding-preview">{content}</main>;
}
