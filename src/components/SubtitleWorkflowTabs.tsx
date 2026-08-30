export type SubtitleWorkflow = "import" | "transcribe" | "translate";

type SubtitleWorkflowTabsProps = {
  workflow: SubtitleWorkflow;
  disabled: boolean;
  onChange: (workflow: SubtitleWorkflow) => void;
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
}: SubtitleWorkflowTabsProps) {
  return (
    <div
      className="subtitle-workflow-switch"
      role="tablist"
      aria-label="字幕准备方式"
    >
      {workflows.map((item) => (
        <button
          className={workflow === item.value ? "active" : ""}
          type="button"
          role="tab"
          aria-selected={workflow === item.value}
          disabled={disabled}
          key={item.value}
          onClick={() => onChange(item.value)}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
