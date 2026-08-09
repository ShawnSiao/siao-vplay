type EnvironmentSettingsTriggerProps = {
  onOpen: () => void;
};

export function EnvironmentSettingsTrigger({
  onOpen,
}: EnvironmentSettingsTriggerProps) {
  return (
    <button
      aria-label="设置"
      className="shell-icon-command"
      type="button"
      title="本地功能资源"
      onClick={onOpen}
    >
      ⚙
    </button>
  );
}

