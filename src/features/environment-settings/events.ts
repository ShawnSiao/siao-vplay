export type EnvironmentSettingsTab = "local" | "ai" | "storage";

const eventName = "siaovplay:open-environment-settings";

function emit(tab: EnvironmentSettingsTab): void {
  window.dispatchEvent(new CustomEvent(eventName, { detail: { tab } }));
}

export function openEnvironmentSettings(tab: EnvironmentSettingsTab): void {
  emit(tab);
}

export function listenEnvironmentSettings(
  listener: (tab: EnvironmentSettingsTab) => void,
): () => void {
  const handler = (event: Event) => {
    const tab = (event as CustomEvent<{ tab?: EnvironmentSettingsTab }>).detail?.tab;
    listener(tab === "ai" || tab === "storage" ? tab : "local");
  };
  window.addEventListener(eventName, handler);
  return () => window.removeEventListener(eventName, handler);
}
