import type { ReactNode } from "react";
import type { SubtitleVersion } from "../types";
import { useTabNavigation } from "./useTabNavigation";

export type SubtitleWorkflow = "import" | "transcribe" | "translate";

type SubtitleWorkflowTabsProps = {
  workflow: SubtitleWorkflow;
  disabled: boolean;
  onChange: (workflow: SubtitleWorkflow) => void;
  children: ReactNode;
};

const workflows: Array<{ value: SubtitleWorkflow; label: string }> = [
  { value: "import", label: "导入字幕" },
  { value: "transcribe", label: "从视频生成" },
  { value: "translate", label: "翻译" },
];

export function SubtitleWorkflowTabs({
  workflow,
  disabled,
  onChange,
  children,
}: SubtitleWorkflowTabsProps) {
  const tabs = useTabNavigation(workflow, onChange);
  return (
    <>
    <div
      className="subtitle-workflow-switch"
      {...tabs.listProps}
      aria-label="字幕准备方式"
    >
      {workflows.map((item) => (
        <button
          className={workflow === item.value ? "active" : ""}
          disabled={disabled}
          key={item.value}
          {...tabs.tabProps(item.value)}
        >
          {item.label}
        </button>
      ))}
    </div>
    <div {...tabs.panelProps}>{children}</div>
    </>
  );
}
export function SubtitleCurrentNote({ version }: { version: SubtitleVersion }) {
  return <div className="subtitle-current-note">
    <span>当前原文字幕</span>
    <strong>{version.sourceLabel}</strong>
    <small>{version.languageCode.toUpperCase()} · {version.segments.length} 条 · 版本 {version.versionNumber} · {version.status === "draft" ? "草稿" : "已检查"}</small>
  </div>;
}
