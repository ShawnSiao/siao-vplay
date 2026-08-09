import { useEffect, useState } from "react";

import { commandError, getCodexRuntimeStatus } from "../../lib/desktop";
import type { CodexRuntimeStatus } from "../../types";

export function LocalCodexDetail({ previewMode }: { previewMode: boolean }) {
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
    void getCodexRuntimeStatus().then(setRuntime).catch((cause) => setError(commandError(cause).message));
  }, [previewMode]);

  const ready = Boolean(runtime?.available && runtime.authenticated && runtime.supported);
  return (
    <section className="environment-provider-detail" aria-label="本机 Codex 状态">
      <div className="environment-detail-scroll">
        <div className="environment-detail-heading">
          <div>
            <h2>本机 Codex</h2>
            <p>检测这台电脑上的 Codex，作为本地理解与学习服务。</p>
          </div>
          <span className={`environment-status-chip ${ready ? "" : "unavailable"}`}>
            {ready ? "可以使用" : "未检测到"}
          </span>
        </div>
        <div className="environment-codex-status">
          <strong>{ready ? `Codex ${runtime?.version ?? ""} 已准备` : "当前没有检测到可用的本机 Codex"}</strong>
          <p>{ready ? "任务材料仅交给这台电脑上的 Codex。" : runtime?.errorMessage ?? error ?? "可以继续使用已配置的 API 服务。"}</p>
        </div>
        <div className="environment-privacy-note">◇ 本机服务不会把字幕或画面发送给外部 API 服务。</div>
      </div>
    </section>
  );
}
