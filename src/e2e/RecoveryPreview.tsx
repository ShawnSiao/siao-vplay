import { RemoteUrlDialog } from "../components/RemoteUrlDialog";
import { useState } from "react";
import { mockIPC } from "@tauri-apps/api/mocks";
import { PreparationScreen } from "../components/PreparationScreen";
import { SubtitleRevisionDialog } from "../components/SubtitleRevisionDialog";
import type { Project, SubtitleSegmentEdit, SubtitleVersion } from "../types";

const project = { id: "recovery-fixture", title: "交互验收样例", revision: 1, playbackState: { positionMs: 0 } } as Project;
const versions: SubtitleVersion[] = (["original", "translation"] as const).map((role) => ({
  id: role, projectId: project.id, role, trackId: role, isCurrent: true, versionNumber: 1,
  createdAtMs: 1, languageCode: role === "original" ? "en" : "zh-cn", mediaSha256: "a".repeat(64),
  sourceSha256: "b".repeat(64), parentVersionId: null, sourceTaskId: null, projectRevision: 1,
  sourceKind: "imported_file", sourceLabel: "Synthetic recovery fixture", status: "ready",
  preflight: { status:"ready", segmentCount:2, errorCount:0, warningCount:0, issues:[],
    firstStartMs:1000, lastEndMs:2500, mediaDurationMs:3000, coverageRatio:1/3 },
  segments: [1, 2].map((n) => ({ confidence:null, sourceSegmentId:null, words:[], id: `${role}-${n}`, lineageId: `${role}-${n}`, ordinal: n, text: `${role} ${n}`, startMs: n * 1000, endMs: n * 1000 + 500, issueKind: null })),
}));

let saveCount = 1;
mockIPC((command, args) => {
  if (command === "get_public_resolver_disclosure") return { receiver: "https://resolver.example", resolverBase: "https://resolver.example/status/" };
  if (command !== "revise_subtitle_version") throw new Error(`Unexpected fixture command: ${command}`);
  const input = (args as Record<string, unknown>).input as { baseVersionId: string; segmentEdits: SubtitleSegmentEdit[] };
  const base = versions.find((v) => v.id === input.baseVersionId)!;
  const version = { ...base, id: `${base.role}-${++saveCount}`, versionNumber: saveCount, projectRevision: saveCount, parentVersionId: base.id,
    segments: base.segments.map((segment) => {
      const edit = input.segmentEdits.find((edit) => edit.segmentId === segment.id);
      return edit ? { ...segment, text: edit.text ?? segment.text, issueKind: edit.issueKind === "none" ? null : edit.issueKind ?? segment.issueKind } : segment;
    }),
  };
  versions.push(version);
  return version;
});

export function RecoveryPreview({ preparation = false, remoteUrl = false }: { preparation?: boolean; remoteUrl?: boolean }) {
  const [closed, setClosed] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  if (closed) return <p>已返回媒体库</p>;
  if (remoteUrl) return <RemoteUrlDialog previewMode={false} onClose={() => setClosed(true)} onImported={() => setClosed(true)} />;
  return preparation ? <PreparationScreen project={project} forceProxy={false} error={null}
    progress={{ requestId: "fixture", projectId: project.id, stage: new URLSearchParams(window.location.search).has("queued") ? "queued" : "transcode", status: cancelling ? "cancelling" : "running" }}
    canCancel cancelling={cancelling} onRetry={() => undefined} onBack={() => setClosed(true)}
    onCancel={() => setCancelling(true)} /> :
    <SubtitleRevisionDialog project={project} versions={versions} onClose={() => setClosed(true)} onVersionCreated={async () => undefined} onRetranslate={() => undefined} />;
}
