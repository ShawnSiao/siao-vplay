import type {
  AiProviderCatalogEntry,
  AiProviderId,
  AiServiceDraft,
  AiServiceSettings,
  AiServiceSummary,
} from "./types";

export const codexSelectionId = "local:codex";

export function providerSelectionId(providerId: AiProviderId): string {
  return `provider:${providerId}`;
}

export function selectedService(
  settings: AiServiceSettings,
  selectionId: string,
): AiServiceSummary | null {
  return settings.services.find((service) => service.id === selectionId) ?? null;
}

export function selectedProvider(
  settings: AiServiceSettings,
  selectionId: string,
): AiProviderCatalogEntry | null {
  const service = selectedService(settings, selectionId);
  const providerId = service?.providerId ??
    (selectionId.startsWith("provider:")
      ? selectionId.slice("provider:".length) as AiProviderId
      : null);
  return settings.providerCatalog.providers.find((entry) => entry.id === providerId) ?? null;
}

export function initialSelection(settings: AiServiceSettings): string {
  return settings.defaultServiceId ?? codexSelectionId;
}

export function draftForSelection(
  settings: AiServiceSettings,
  selectionId: string,
): AiServiceDraft | null {
  const service = selectedService(settings, selectionId);
  const provider = selectedProvider(settings, selectionId);
  if (!provider) {
    return null;
  }
  return {
    id: service?.id ?? null,
    providerId: provider.id,
    displayName: service?.displayName ?? provider.displayName,
    protocol: provider.protocol,
    baseUrl: service?.baseUrl ?? provider.officialBaseUrl ?? "",
    modelId: service?.modelId ?? "",
    apiKey: "",
    makeDefault: service?.isDefault ?? settings.services.length === 0,
  };
}

export function findSavedService(
  previous: AiServiceDraft,
  settings: AiServiceSettings,
): AiServiceSummary | null {
  if (previous.id) {
    return settings.services.find((service) => service.id === previous.id) ?? null;
  }
  const matches = settings.services.filter(
    (service) =>
      service.providerId === previous.providerId &&
      service.displayName === previous.displayName,
  );
  return matches.at(-1) ?? null;
}
