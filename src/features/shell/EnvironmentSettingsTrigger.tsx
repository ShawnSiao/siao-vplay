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
      title={`环境配置 · ${status}`}
      onClick={onOpen}
    >
      <span aria-hidden="true">⚙</span>
      <span>
        <strong>环境配置</strong>
        <small>本地功能与 AI 服务</small>
      </span>
    </button>
  );
}
