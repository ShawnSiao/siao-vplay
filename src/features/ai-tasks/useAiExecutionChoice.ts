import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import type { AiTaskExecutionInfo } from "../../types";
import { listenAiServiceSettings } from "../environment-settings/events";
import {
  commandMessage,
  getAiServiceSettings,
  previewAiExecution,
} from "../environment-settings/gateway";
import type {
  AiExecutionPreview,
  AiExecutionTarget,
  AiMaterialAuthorization,
  AiServiceSettings,
  AiServiceSummary,
} from "../environment-settings/types";

export type AiExecutionChoiceKind = "api" | "codex" | "manual";

export function executionForTask(
  execution: AiTaskExecutionInfo | undefined,
  fallbackKind: "manual" | "codex" | "api",
): AiExecutionTarget {
  if ((!execution && fallbackKind === "api") ||
      (execution?.kind === "api" && (!execution.serviceConfigId || !execution.modelId))) {
    throw new Error("原任务的 API 服务信息不完整，请重新选择服务并确认发送范围。");
  }
  if (!execution) return fallbackKind === "manual" ? { kind: "manual" } : { kind: "codex" };
  if (execution.kind === "api" && execution.serviceConfigId && execution.modelId) {
    return { kind: "api", serviceConfigId: execution.serviceConfigId, modelId: execution.modelId };
  }
  return execution.kind === "manual" ? { kind: "manual" } : { kind: "codex" };
}

export function authorizationForTask(
  execution: AiTaskExecutionInfo | undefined,
  frames: boolean,
): AiMaterialAuthorization {
  return {
    subtitles: true,
    currentQuestion: true,
    frames,
    serviceRevision: execution?.serviceRevision ?? null,
  };
}

function usableServices(settings: AiServiceSettings | null): AiServiceSummary[] {
  return settings?.services.filter(
    (service) => service.credentialState === "stored" && Boolean(service.modelId),
  ) ?? [];
}

export type AiExecutionChoiceDraft = { kind: AiExecutionChoiceKind; serviceId: string | null; modelId: string };
export function useAiExecutionChoice(allowFrames: boolean, initialChoice?: AiExecutionChoiceDraft) {
  const [restoredChoice] = useState(initialChoice);
  const [settings, setSettings] = useState<AiServiceSettings | null>(null);
  const [kind, setKindState] = useState<AiExecutionChoiceKind>(restoredChoice?.kind ?? "codex");
  const [serviceId, setServiceId] = useState<string | null>(restoredChoice?.serviceId ?? null);
  const [modelId, setModelId] = useState(restoredChoice?.modelId ?? "");
  const [frames, setFrames] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let updated = false;
    const unsubscribe = listenAiServiceSettings((next) => {
      updated = true;
      setSettings(next);
      setFrames(false);
      setError(null);
      setLoading(false);
    });
    void getAiServiceSettings()
      .then((next) => {
        if (!active || updated) return;
        setSettings(next);
        const preferred = next.services.find((service) => service.id === next.defaultServiceId);
        if (!restoredChoice && preferred?.credentialState === "stored" && preferred.modelId) {
          setKindState("api");
          setServiceId(preferred.id);
          setModelId(preferred.modelId);
          setFrames(false);
        }
      })
      .catch((cause) => {
        if (active && !updated) setError(commandMessage(cause));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; unsubscribe(); };
  }, [restoredChoice]);

  const services = useMemo(() => usableServices(settings), [settings]);
  const service = services.find((item) => item.id === serviceId) ?? (serviceId === null ? services[0] ?? null : null);
  const currentChoice = useRef({ modelId, service });
  useLayoutEffect(() => { currentChoice.current = { modelId, service }; }, [modelId, service]);

  const setKind = useCallback((nextKind: AiExecutionChoiceKind) => {
    setKindState(nextKind);
    const { modelId, service } = currentChoice.current;
    if (nextKind === "api" && !modelId && service) {
      setServiceId(service.id);
      setModelId(service.modelId ?? "");
    }
    setFrames(false);
    setError(null);
  }, []);

  const selectService = useCallback((id: string) => {
    const next = usableServices(settings).find((service) => service.id === id);
    setServiceId(id);
    setModelId(next?.modelId ?? "");
    setFrames(false);
    setError(null);
  }, [settings]);

  const execution = useMemo<AiExecutionTarget | null>(() => {
    if (kind === "manual") return { kind: "manual" };
    if (kind === "codex") return { kind: "codex" };
    if (!service || !modelId.trim()) return null;
    return { kind: "api", serviceConfigId: service.id, modelId: modelId.trim() };
  }, [kind, modelId, service]);

  const authorization = useMemo<AiMaterialAuthorization>(() => ({
    subtitles: true,
    currentQuestion: true,
    frames: allowFrames && frames,
    serviceRevision: kind === "api" ? service?.revision ?? null : null,
  }), [allowFrames, frames, kind, service?.revision]);

  const preview = useCallback(async (): Promise<{
    execution: AiExecutionTarget;
    authorization: AiMaterialAuthorization;
    preview: AiExecutionPreview;
  }> => {
    if (!execution) throw new Error("请先选择可以使用的 AI 服务和模型。");
    setError(null);
    try {
      return {
        execution,
        authorization,
        preview: await previewAiExecution(execution, authorization),
      };
    } catch (cause) {
      setError(commandMessage(cause));
      throw cause;
    }
  }, [authorization, execution]);

  return {
    settings,
    services,
    service,
    kind,
    serviceId: serviceId ?? service?.id ?? null,
    modelId,
    frames,
    loading,
    error,
    execution,
    authorization,
    setKind,
    selectService,
    setModelId,
    setFrames,
    preview,
  };
}

export type AiExecutionChoiceController = ReturnType<typeof useAiExecutionChoice>;
