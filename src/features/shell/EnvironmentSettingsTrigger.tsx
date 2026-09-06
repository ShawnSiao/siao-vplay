import "../environment-settings/environment-settings-shell.css";

type EnvironmentSettingsTriggerProps = {
  onOpen: () => void;
  status: string;
};

export function EnvironmentSettingsTrigger({
  onOpen,
  status,
}: EnvironmentSettingsTriggerProps) {
  return (
    <button
      aria-label="设置"
      className="environment-navigation-trigger"
      type="button"
      title={`设置 · ${status}`}
      onClick={onOpen}
    >
      <span aria-hidden="true">⚙</span>
      <span>
        <strong>设置</strong>
        <small>本地功能与 AI 服务</small>
      </span>
    </button>
  );
}
