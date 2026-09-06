import { SummaryProgress } from "../features/summary/SummaryProgress";
import { SummaryResultView } from "../features/summary/SummaryResultView";
import { createSummaryFixtures } from "../test-fixtures/summary";
import { VideoSummaryPanel } from "../features/summary/VideoSummaryPanel";
import type { SubtitleVersion } from "../types";

export function SummaryPreview({ state, sourceVersion }: { state: "progress" | "result" | "confirm"; sourceVersion: SubtitleVersion }) {
  const { task, summary } = createSummaryFixtures();
  return (
    <main className="understanding-preview">
      <section className="understanding-shell embedded" aria-label="视频总结预览">
        <div className="understanding-inner-tabs" role="tablist" aria-label="理解类型">
          <button type="button" role="tab">当前场景</button>
          <button className="active" type="button" role="tab" aria-selected="true">视频总结</button>
        </div>
        <div className="understanding-tab-content">
          <div className="video-summary-panel">
            {state === "confirm" ? <VideoSummaryPanel projectId="project-1" playbackCutoffMs={15_000}
              durationMs={120_000} sourceVersion={sourceVersion} translationVersion={null}
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
                onExport={() => undefined}
                onNewSummary={() => undefined}
              />
            )}
          </div>
        </div>
      </section>
    </main>
  );
}
