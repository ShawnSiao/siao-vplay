import type { AiServiceSettings } from "./types";
export type EnvironmentSettingsTab = "local" | "ai" | "storage";

const serviceEventName = "siaovplay:ai-service-settings-changed";
export function publishAiServiceSettings(settings: AiServiceSettings): void {
  window.dispatchEvent(new CustomEvent(serviceEventName, { detail: settings }));
}
export function listenAiServiceSettings(listener: (settings: AiServiceSettings) => void): () => void {
  const handler = (event: Event) => listener((event as CustomEvent<AiServiceSettings>).detail);
  window.addEventListener(serviceEventName, handler);
  return () => window.removeEventListener(serviceEventName, handler);
}

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
