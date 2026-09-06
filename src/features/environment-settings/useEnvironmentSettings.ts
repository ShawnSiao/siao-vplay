import { useCallback, useEffect, useRef, useState } from "react";

import {
  commandMessage,
  deleteAiService,
  getAiServiceSettings,
  getNetworkSettings,
  listAiServiceModels,
  saveAiService,
  setDefaultAiService,
  setNetworkSettings,
  testAiService,
} from "./gateway";
import { previewAiSettings, previewNetworkSettings } from "./previewData";
import {
  codexSelectionId,
  draftForSelection,
  findSavedService,
  initialSelection,
  selectedProvider,
  selectedService,
} from "./serviceSelection";
import type {
  AiModelInfo,
  AiServiceDraft,
  AiServiceProbeInput,
  AiServiceSettings,
  AiServiceTestResult,
  NetworkSettings,
} from "./types";

type Operation = "loading" | "saving" | "testing" | "models" | "deleting" | "network";

export function useEnvironmentSettings(open: boolean, previewMode: boolean) {
  const [settings, setSettings] = useState<AiServiceSettings | null>(null);
  const [network, setNetwork] = useState<NetworkSettings | null>(null);
  const [selectionId, setSelectionId] = useState(codexSelectionId);
  const [draft, setDraft] = useState<AiServiceDraft | null>(null);
  const [models, setModels] = useState<AiModelInfo[]>([]);
  const [testResult, setTestResult] = useState<AiServiceTestResult | null>(null);
  const [operation, setOperation] = useState<Operation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const selectionRef = useRef(codexSelectionId);
  const draftsRef = useRef(new Map<string, AiServiceDraft>());
  const [dirtySelectionIds, setDirtySelectionIds] = useState<string[]>([]);

  const applySettings = useCallback((next: AiServiceSettings, selectInitial = false) => {
    setSettings(next);
    const nextSelection = selectInitial ? initialSelection(next) : selectionRef.current;
    const validSelection = nextSelection === codexSelectionId ||
      next.services.some((service) => service.id === nextSelection) ||
      nextSelection.startsWith("provider:");
    const resolvedSelection = validSelection ? nextSelection : initialSelection(next);
    selectionRef.current = resolvedSelection;
    setSelectionId(resolvedSelection);
    setDraft(draftsRef.current.get(resolvedSelection) ?? draftForSelection(next, resolvedSelection));
  }, []);

  const load = useCallback(async () => {
    setOperation("loading");
    setError(null);
    try {
      if (previewMode) {
        applySettings(previewAiSettings, true);
        setNetwork(previewNetworkSettings);
      } else {
        const [nextSettings, nextNetwork] = await Promise.all([
          getAiServiceSettings(),
          getNetworkSettings(),
        ]);
        applySettings(nextSettings, true);
        setNetwork(nextNetwork);
      }
    } catch (cause) {
      setError(commandMessage(cause));
    } finally {
      setOperation(null);
    }
  }, [applySettings, previewMode]);

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load, open]);

  const select = useCallback((id: string) => {
    if (!settings || operation) return;
    selectionRef.current = id;
    setSelectionId(id);
    setDraft(draftsRef.current.get(id) ?? draftForSelection(settings, id));
    setModels([]);
    setTestResult(null);
    setError(null);
  }, [operation, settings]);

  const updateDraft = useCallback((patch: Partial<AiServiceDraft>) => {
    if (!draft || !settings || operation) return;
    const next = { ...draft, ...patch };
    const id = selectionRef.current;
    if (JSON.stringify(next) === JSON.stringify(draftForSelection(settings, id))) draftsRef.current.delete(id);
    else draftsRef.current.set(id, next);
    setDirtySelectionIds([...draftsRef.current.keys()]);
    setDraft(next);
    setTestResult(null);
  }, [draft, operation, settings]);

  const probeInput = useCallback((): AiServiceProbeInput | null => {
    if (!draft) return null;
    return {
      serviceConfigId: draft.id,
      providerId: draft.providerId,
      protocol: draft.protocol,
      baseUrl: draft.baseUrl || null,
      modelId: draft.modelId || null,
      apiKey: draft.apiKey || null,
    };
  }, [draft]);

  const refreshModels = useCallback(async () => {
    const input = probeInput();
    if (!input || previewMode) return;
    setOperation("models");
    setError(null);
    try {
      const result = await listAiServiceModels(input);
      setModels(result.models);
      if (!draft?.modelId && result.models[0]) {
        updateDraft({ modelId: result.models[0].id });
      }
    } catch (cause) {
      setError(commandMessage(cause));
    } finally {
      setOperation(null);
    }
  }, [draft, previewMode, probeInput, updateDraft]);

  const test = useCallback(async () => {
    const input = probeInput();
    if (!input) return;
    setOperation("testing");
    setError(null);
    try {
      if (previewMode) {
        setTestResult({ state: "ready", models: [], selectedModelId: draft?.modelId ?? null, capabilities: { understanding: true, learning: true, vision: false }, minimalRequestUsed: true, mayIncurUsage: true, providerRequestId: null });
      } else {
        const result = await testAiService(input);
        setTestResult(result);
        setModels(result.models);
        if (draft?.id) {
          applySettings(await getAiServiceSettings());
        }
      }
    } catch (cause) {
      setError(commandMessage(cause));
    } finally {
      setOperation(null);
    }
  }, [applySettings, draft, previewMode, probeInput]);

  const save = useCallback(async () => {
    if (!settings || !draft) return;
    setOperation("saving");
    setError(null);
    try {
      if (previewMode) return;
      let next = await saveAiService(settings.revision, draft);
      const saved = findSavedService(draft, next);
      if (saved && draft.makeDefault && !saved.isDefault) {
        next = await setDefaultAiService(next.revision, saved.id);
      } else if (saved?.isDefault && !draft.makeDefault) {
        next = await setDefaultAiService(next.revision, null);
      }
      if (saved) {
        draftsRef.current.delete(selectionRef.current);
        draftsRef.current.delete(saved.id);
        setDirtySelectionIds([...draftsRef.current.keys()]);
        selectionRef.current = saved.id;
        setSelectionId(saved.id);
      }
      setSettings(next);
      setDraft(saved ? draftForSelection(next, saved.id) : null);
      setTestResult(null);
    } catch (cause) {
      setError(commandMessage(cause));
    } finally {
      setOperation(null);
    }
  }, [draft, previewMode, settings]);

  const remove = useCallback(async () => {
    if (!settings || !draft?.id || previewMode) return;
    setOperation("deleting");
    setError(null);
    try {
      const next = await deleteAiService(settings.revision, draft.id);
      draftsRef.current.delete(selectionRef.current);
      setDirtySelectionIds([...draftsRef.current.keys()]);
      applySettings(next, true);
    } catch (cause) {
      setError(commandMessage(cause));
    } finally {
      setOperation(null);
    }
  }, [applySettings, draft, previewMode, settings]);

  const saveProxy = useCallback(async (proxyUrl: string | null) => {
    if (!network) return;
    setOperation("network");
    setError(null);
    try {
      setNetwork(previewMode ? { ...network, customProxyUrl: proxyUrl } : await setNetworkSettings(network.revision, proxyUrl));
    } catch (cause) {
      setError(commandMessage(cause));
    } finally {
      setOperation(null);
    }
  }, [network, previewMode]);

  const service = settings ? selectedService(settings, selectionId) : null;
  const provider = settings ? selectedProvider(settings, selectionId) : null;
  return {
    settings, network, selectionId, draft, models, testResult, operation, error, dirtySelectionIds,
    service, provider,
    select, updateDraft, refreshModels, test, save, remove, saveProxy, clearError: () => setError(null),
  };
}

export type EnvironmentSettingsController = ReturnType<typeof useEnvironmentSettings>;
