import { useState } from "react";

import type { EnvironmentSettingsController } from "./useEnvironmentSettings";

function Toggle({ checked, disabled = false, label, onChange }: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      className={`environment-toggle ${checked ? "on" : ""}`}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    />
  );
}

export function AiServiceEditor({ controller }: { controller: EnvironmentSettingsController }) {
  const { draft, provider, service, models, testResult, operation, error, updateDraft } = controller;
  const [editingKey, setEditingKey] = useState(Boolean(controller.draft?.apiKey));
  const [advancedOpen, setAdvancedOpen] = useState(false);

  if (!draft || !provider) {
    return <section className="environment-provider-detail" />;
  }
  const configured = service?.credentialState === "stored";
  const custom = provider.id === "custom";
  const capabilities = testResult?.capabilities ?? service?.capabilities ?? {
    understanding: true,
    learning: true,
    vision: false,
  };
  const testing = operation === "testing";
  const loadingModels = operation === "models";

  const remove = () => {
    if (window.confirm(`删除「${draft.displayName}」？保存的 API Key 也会同时删除。`)) {
      void controller.remove();
    }
  };

  return (
    <section className="environment-provider-detail" aria-label={`${draft.displayName} 配置`}>
      <div className="environment-detail-scroll">
        <div className="environment-detail-heading">
          <div>
            <h2>{configured ? draft.displayName : custom ? "添加其他兼容服务" : `配置 ${draft.displayName}`}</h2>
            <p>用于字幕翻译、内容理解与学习辅助</p>
          </div>
          {controller.dirtySelectionIds.includes(controller.selectionId) ? <span className="environment-status-chip">未保存</span> : configured ? <span className="environment-status-chip">已保存</span> : null}
        </div>

        <div className="environment-capabilities" aria-label="服务能力">
          <span>翻译与理解</span>
          <span>学习辅助</span>
          <span className={capabilities.vision ? "" : "disabled"}>
            {capabilities.vision ? "可读取画面" : "仅使用字幕"}
          </span>
        </div>

        <div className="environment-form-stack">
          {custom ? (
            <label className="environment-form-row">
              <span>服务名称</span>
              <input value={draft.displayName} placeholder="例如：公司内部服务" onChange={(event) => updateDraft({ displayName: event.target.value })} />
              <i />
            </label>
          ) : null}

          <label className="environment-form-row environment-key-row">
            <span>API Key</span>
            {configured && !editingKey ? (
              <input value="••••••••••••••••••••••••" readOnly tabIndex={-1} aria-label="API Key 已安全保存" />
            ) : (
              <input
                type="password"
                autoComplete="off"
                value={draft.apiKey}
                placeholder={configured ? "输入新的 API Key" : "粘贴服务商提供的 API Key"}
                onChange={(event) => updateDraft({ apiKey: event.target.value })}
              />
            )}
            {configured ? (
              <button className="button quiet" type="button" onClick={() => {
                setEditingKey((value) => !value);
                updateDraft({ apiKey: "" });
              }}>
                {editingKey ? "取消更换" : "更换"}
              </button>
            ) : <i />}
            <small>{configured && !editingKey ? "密钥已保存在 Windows 凭据管理器中，应用不会反显。" : "密钥不会写入项目文件、数据库或日志。"}</small>
          </label>

          <label className="environment-form-row environment-model-row">
            <span>模型</span>
            <input
              list="environment-model-options"
              value={draft.modelId}
              placeholder="连接后选择或手动填写模型"
              onChange={(event) => updateDraft({ modelId: event.target.value })}
            />
            <button className="button quiet" type="button" disabled={loadingModels || (!configured && !draft.apiKey)} onClick={() => void controller.refreshModels()}>
              {loadingModels ? "获取中…" : "获取模型"}
            </button>
            <datalist id="environment-model-options">
              {models.map((model) => <option key={model.id} value={model.id}>{model.displayName}</option>)}
            </datalist>
            <small>{models.length > 0 ? `已获取 ${models.length} 个模型，也可以手动填写。` : "无法获取列表时可以手动填写模型名称。"}</small>
          </label>

          <div className="environment-switch-row">
            <span>
              <strong>设为默认 AI 服务</strong>
              <small>理解和学习功能优先使用此服务。</small>
            </span>
            <Toggle checked={draft.makeDefault} label="设为默认 AI 服务" onChange={(makeDefault) => updateDraft({ makeDefault })} />
          </div>

          <div className="environment-switch-row">
            <span>
              <strong>允许使用画面</strong>
              <small>{capabilities.vision ? "可在每次发送前单独授权受控关键帧。" : "当前模型只使用已读取的字幕。"}</small>
            </span>
            <Toggle checked={false} disabled label="允许使用画面" onChange={() => undefined} />
          </div>

          <div className="environment-advanced">
            <button type="button" aria-expanded={advancedOpen} onClick={() => setAdvancedOpen((value) => !value)}>
              <span>服务地址与网络设置</span>
              <span>{custom ? "自定义服务" : "使用官方服务"} <b>{advancedOpen ? "⌃" : "⌄"}</b></span>
            </button>
            {advancedOpen ? (
              <label>
                <span>服务地址</span>
                <input
                  value={draft.baseUrl}
                  disabled={!custom}
                  placeholder="https://api.example.com/v1"
                  onChange={(event) => updateDraft({ baseUrl: event.target.value })}
                />
              </label>
            ) : null}
          </div>
        </div>

        <div className="environment-scope-card">
          <strong>发送范围</strong>
          <span>✓ 当前播放点之前的字幕</span>
          <span>✓ 当前问题或所选词句</span>
          <span className={capabilities.vision ? "" : "disabled"}>• 受控关键帧（使用时再次确认）</span>
        </div>
        <div className="environment-privacy-note">ⓘ 测试连接只发送固定测试内容，可能产生极少量 API 用量，不会发送视频或字幕。</div>
        {testing ? <div className="environment-connection-result">◌ 正在检查鉴权、模型和服务能力…</div> : null}
        {testResult?.state === "ready" ? <div className="environment-connection-result success">✓ 连接成功，已确认当前模型可用。</div> : null}
        {error ? <div className="environment-error" role="alert">{error}</div> : null}
        {service ? <button className="button text environment-delete-service" type="button" disabled={operation !== null} onClick={remove}>删除此服务</button> : null}
      </div>
    </section>
  );
}
