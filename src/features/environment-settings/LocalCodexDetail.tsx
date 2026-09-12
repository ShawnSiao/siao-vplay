import { useEffect, useState } from "react";

import { commandError, getCodexRuntimeStatus } from "../../lib/desktop";
import type { CodexRuntimeStatus } from "../../types";

export function LocalCodexDetail({ previewMode, refreshKey = 0 }: { previewMode: boolean; refreshKey?: number }) {
  const [runtime, setRuntime] = useState<CodexRuntimeStatus | null>(() => previewMode ? {
    available: false,
    authenticated: false,
    supported: false,
    version: null,
    authMode: null,
    minimumVersion: "",
    errorCode: "preview",
    errorMessage: "浏览器预览不检测本机 Codex。",
  } : null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (previewMode) return;
    let active = true;
    void getCodexRuntimeStatus().then((next) => {
      if (active) { setRuntime(next); setError(null); }
    }).catch((cause) => {
      if (active) { setRuntime(null); setError(commandError(cause).message); }
    });
    return () => { active = false; };
  }, [previewMode, refreshKey]);

  const ready = Boolean(runtime?.available && runtime.authenticated && runtime.supported);
  return (
    <section className="environment-provider-detail" aria-label="本机 Codex 状态">
      <div className="environment-detail-scroll">
        <div className="environment-detail-heading">
          <div>
            <h2>本机 Codex</h2>
            <p>检测这台电脑上的 Codex 客户端，用于通过 OpenAI 服务处理任务。</p>
          </div>
          <span className={`environment-status-chip ${ready ? "" : "unavailable"}`}>
            {ready ? "可以使用" : "未检测到"}
          </span>
        </div>
        <div className="environment-codex-status">
          <strong>{ready ? `Codex ${runtime?.version ?? ""} 已准备` : "当前没有检测到可用的本机 Codex"}</strong>
          <p>{ready ? "经授权的任务材料会通过 Codex 发送至 OpenAI。" : error ?? runtime?.errorMessage ?? "可以继续使用已配置的 API 服务。"}</p>
        </div>
        <div className="environment-privacy-note">本机安装不代表离线推理。任务使用 OpenAI 服务，不读取用户的模型服务配置；执行前请核对发送范围。</div>
      </div>
    </section>
  );
}
