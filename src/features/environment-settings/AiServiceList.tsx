import anthropicLogo from "../../assets/ai-service-logos/anthropic.svg";
import chatGlmLogo from "../../assets/ai-service-logos/chatglm.svg";
import codexLogo from "../../assets/ai-service-logos/codex.svg";
import deepSeekLogo from "../../assets/ai-service-logos/deepseek.svg";
import geminiLogo from "../../assets/ai-service-logos/gemini.svg";
import kimiLogo from "../../assets/ai-service-logos/kimi.svg";
import openAiLogo from "../../assets/ai-service-logos/openai.svg";
import { codexSelectionId, providerSelectionId } from "./serviceSelection";
import type { EnvironmentSettingsController } from "./useEnvironmentSettings";
import type { AiProviderId, AiServiceSummary } from "./types";

const logos: Partial<Record<AiProviderId, string>> = {
  openai: openAiLogo,
  anthropic: anthropicLogo,
  gemini: geminiLogo,
  deepseek: deepSeekLogo,
  kimi: kimiLogo,
  glm: chatGlmLogo,
};

type ServiceStatus = {
  label: string;
  tone: "ready" | "untested" | "error" | "neutral";
};

function serviceStatus(service: AiServiceSummary | undefined): ServiceStatus {
  if (!service) return { label: "未配置", tone: "neutral" };
  if (service.credentialState !== "stored") {
    return { label: "需要 API Key", tone: "neutral" };
  }
  if (service.connectionState === "ready") {
    return {
      label: service.isDefault ? "已连接 · 默认" : "已连接",
      tone: "ready",
    };
  }
  if (service.connectionState === "error") {
    return { label: "连接异常", tone: "error" };
  }
  return {
    label: service.isDefault ? "已配置，未测试 · 默认" : "已配置，未测试",
    tone: "untested",
  };
}

type ServiceRowProps = {
  id: string;
  logo?: string;
  mark?: string;
  name: string;
  status: ServiceStatus;
  selected: boolean;
  onSelect: () => void;
};

function ServiceRow({ id, logo, mark, name, status, selected, onSelect }: ServiceRowProps) {
  return (
    <button
      className={`environment-provider-row ${selected ? "selected" : ""}`}
      data-service-id={id}
      type="button"
      onClick={onSelect}
    >
      <span className="environment-provider-logo" aria-hidden="true">
        {logo ? <img src={logo} alt="" /> : mark}
      </span>
      <span className="environment-provider-copy">
        <strong>{name}</strong>
      </span>
      <span className={`environment-provider-status ${status.tone}`}>
        {status.label}
      </span>
    </button>
  );
}

export function AiServiceList({ controller }: { controller: EnvironmentSettingsController }) {
  const { settings, selectionId, select } = controller;
  if (!settings) return <aside className="environment-provider-panel" />;
  const builtIns = settings.providerCatalog.providers.filter((provider) => provider.id !== "custom");
  const customServices = settings.services.filter((service) => service.providerId === "custom");

  return (
    <aside className="environment-provider-panel" aria-label="AI 服务列表">
      <h2>可用服务</h2>
      <div className="environment-provider-list">
        <ServiceRow
          id={codexSelectionId}
          logo={codexLogo}
          name="本机 Codex"
          status={{ label: "本机检测", tone: "neutral" }}
          selected={selectionId === codexSelectionId}
          onSelect={() => select(codexSelectionId)}
        />
        {builtIns.map((provider) => {
          const service = settings.services.find((item) => item.providerId === provider.id);
          const id = service?.id ?? providerSelectionId(provider.id);
          return (
            <ServiceRow
              key={provider.id}
              id={id}
              logo={logos[provider.id]}
              name={provider.displayName}
              status={serviceStatus(service)}
              selected={selectionId === id}
              onSelect={() => select(id)}
            />
          );
        })}
        {customServices.map((service) => (
          <ServiceRow
            key={service.id}
            id={service.id}
            mark="+"
            name={service.displayName}
            status={serviceStatus(service)}
            selected={selectionId === service.id}
            onSelect={() => select(service.id)}
          />
        ))}
      </div>
      <button
        className="button quiet environment-add-provider"
        type="button"
        onClick={() => select(providerSelectionId("custom"))}
      >
        ＋ 添加其他服务
      </button>
    </aside>
  );
}
