import type { CodexRuntimeStatus } from "../../types";
import { openEnvironmentSettings } from "../environment-settings/events";
import type { AiExecutionChoiceController, AiExecutionChoiceKind } from "./useAiExecutionChoice";
import "./ai-execution-confirm.css";

type AiExecutionConfirmProps = {
  controller: AiExecutionChoiceController;
  runtime: CodexRuntimeStatus | null;
  allowFrames: boolean;
  translationAvailable: boolean;
  taskLabel: string;
};

const choiceLabels: Array<[AiExecutionChoiceKind, string, string]> = [
  ["api", "AI 服务", "使用保存的 API"],
  ["codex", "本机 Codex", "调用其配置的模型服务"],
  ["manual", "复制提示词", "自行选择其他工具"],
];

export function AiExecutionConfirm({
  controller,
  runtime,
  allowFrames,
  translationAvailable,
  taskLabel,
}: AiExecutionConfirmProps) {
  const runtimeReady = Boolean(runtime?.available && runtime.authenticated && runtime.supported);
  const apiAvailable = controller.services.length > 0;
  const receiver = controller.kind === "api"
    ? controller.service?.displayName ?? "尚未配置"
    : controller.kind === "codex" ? "本机 Codex" : "自行选择的工具";
  const visionAvailable = controller.kind !== "api" || Boolean(controller.service?.capabilities.vision);

  return (
    <section className="ai-execution-confirm" aria-label={`${taskLabel}发送确认`}>
      <div className="ai-execution-choices" aria-label="处理方式">
        {choiceLabels.map(([kind, title, subtitle]) => {
          const disabled = kind === "api" && !apiAvailable;
          return (
            <button
              key={kind}
              className={controller.kind === kind ? "selected" : ""}
              type="button"
              disabled={disabled}
              onClick={() => controller.setKind(kind)}
            >
              <strong>{title}</strong>
              <small>{disabled ? "先到环境配置添加" : subtitle}</small>
            </button>
          );
        })}
      </div>

      {controller.kind === "api" && apiAvailable ? (
        <div className="ai-execution-service">
          <label>
            <span>接收服务</span>
            <select value={controller.serviceId ?? ""} onChange={(event) => controller.selectService(event.target.value)}>
              {controller.services.map((service) => <option key={service.id} value={service.id}>{service.displayName}</option>)}
            </select>
          </label>
          <label>
            <span>模型</span>
            <input value={controller.modelId} onChange={(event) => controller.setModelId(event.target.value)} />
          </label>
        </div>
      ) : null}

      {controller.kind === "api" && !apiAvailable ? (
        <button className="button quiet ai-configure-service" type="button" onClick={() => openEnvironmentSettings("ai")}>进入环境配置添加 AI 服务</button>
      ) : null}
      {controller.kind === "codex" && runtime && !runtimeReady ? (
        <div className="ai-execution-warning">
          <strong>本机 Codex 当前不可用</strong>
          <span>{runtime.errorMessage}</span>
        </div>
      ) : null}

      <div className="ai-execution-scope">
        <div><span>接收方</span><strong>{receiver}</strong></div>
        {controller.kind === "codex" ? <p>Codex 可能向其配置的模型服务发送下列材料。本机安装不代表离线推理，请先核对 Codex 的接收服务。</p> : null}
        {controller.kind === "api" ? <div><span>模型</span><strong>{controller.modelId || "尚未选择"}</strong></div> : null}
        <ul>
          <li>当前播放点之前的原文字幕</li>
          {translationAvailable ? <li>已有的简体中文字幕</li> : null}
          <li>当前问题或用户选择的词句</li>
        </ul>
        {allowFrames ? (
          <label className={!visionAvailable ? "disabled" : ""}>
            <input
              type="checkbox"
              checked={controller.frames && visionAvailable}
              disabled={!visionAvailable}
              onChange={(event) => controller.setFrames(event.target.checked)}
            />
            允许发送当前播放点之前的受控关键帧
          </label>
        ) : null}
        <p>不包含完整视频、音频、本机媒体路径、数据库或凭证。</p>
      </div>
      {controller.error ? <div className="ai-execution-error" role="alert">{controller.error}</div> : null}
      <p className="ai-no-fallback">请求失败后不会自动改发给其他厂商，可重试或手动切换服务。</p>
    </section>
  );
}
