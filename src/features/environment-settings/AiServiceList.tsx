import { codexSelectionId, providerSelectionId } from "./serviceSelection";
import type { EnvironmentSettingsController } from "./useEnvironmentSettings";
import type { AiProviderId, AiServiceSummary } from "./types";

const marks: Record<AiProviderId, string> = {
  openai: "OA",
  anthropic: "AI",
  gemini: "G",
  deepseek: "DS",
  kimi: "K",
  glm: "GLM",
  custom: "+",
};

function statusText(service: AiServiceSummary | undefined): string {
  if (!service) return "未配置";
  if (service.credentialState !== "stored") return "需要 API Key";
  if (service.connectionState === "ready") {
    return service.isDefault ? "已连接 · 默认" : "已连接";
  }
  if (service.connectionState === "error") return "连接异常";
  return service.isDefault ? "已保存 · 默认" : "已保存";
}

type ServiceRowProps = {
  id: string;
  mark: string;
  name: string;
  status: string;
  ready: boolean;
  selected: boolean;
  onSelect: () => void;
};

function ServiceRow({ id, mark, name, status, ready, selected, onSelect }: ServiceRowProps) {
  return (
    <button
      className={`environment-provider-row ${selected ? "selected" : ""}`}
      data-service-id={id}
      type="button"
      onClick={onSelect}
    >
      <span className="environment-provider-logo" aria-hidden="true">{mark}</span>
      <span className="environment-provider-copy">
        <strong>{name}</strong>
        <small>{status}</small>
      </span>
      <span className={ready ? "environment-provider-state ready" : "environment-provider-state"} aria-hidden="true">
        {ready ? "●" : "○"}
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
          mark="‹/›"
          name="本机 Codex"
          status="本机检测"
          ready={false}
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
              mark={marks[provider.id]}
              name={provider.displayName}
              status={statusText(service)}
              ready={service?.credentialState === "stored"}
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
            status={statusText(service)}
            ready={service.credentialState === "stored"}
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
