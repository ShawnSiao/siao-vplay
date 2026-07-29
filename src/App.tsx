import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

type AppStatus = {
  appName: string;
  version: string;
  platform: string;
  dataDirectory: string;
};

const browserStatus: AppStatus = {
  appName: "SiaoVPlay",
  version: "0.1.0",
  platform: "browser-preview",
  dataDirectory: "W:\\SiaoVPlay\\app-data",
};

async function loadAppStatus(): Promise<AppStatus> {
  if (!("__TAURI_INTERNALS__" in window)) {
    return browserStatus;
  }

  return invoke<AppStatus>("get_app_status");
}

export default function App() {
  const [status, setStatus] = useState<AppStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    loadAppStatus()
      .then((value) => {
        if (active) {
          setStatus(value);
        }
      })
      .catch((reason: unknown) => {
        if (active) {
          setError(reason instanceof Error ? reason.message : String(reason));
        }
      });

    return () => {
      active = false;
    };
  }, []);

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="SiaoVPlay 首页">
          <span className="brand-mark" aria-hidden="true">
            S
          </span>
          <span>SiaoVPlay</span>
        </a>
        <span className="phase-badge">Phase 1 · 本地项目</span>
      </header>

      <section className="hero" aria-labelledby="hero-title">
        <p className="eyebrow">本地优先 · Windows 桌面</p>
        <h1 id="hero-title">从一段视频开始，安静地看懂它。</h1>
        <p className="hero-copy">
          Phase 1 正在建立项目库、本地播放和进度恢复。视频不会被上传，删除项目也不会删除源文件。
        </p>
        <div className="hero-actions">
          <button className="primary-action" type="button" disabled>
            导入本地视频
          </button>
          <span>项目功能将在当前阶段逐步接通</span>
        </div>
      </section>

      <section className="status-panel" aria-live="polite">
        <div>
          <p className="eyebrow">桌面基础状态</p>
          <h2>{error ? "连接失败" : status ? "Core 已连接" : "正在检查 Core"}</h2>
        </div>
        {error ? (
          <p className="error-copy">{error}</p>
        ) : (
          <dl>
            <div>
              <dt>应用</dt>
              <dd>{status?.appName ?? "—"}</dd>
            </div>
            <div>
              <dt>版本</dt>
              <dd>{status?.version ?? "—"}</dd>
            </div>
            <div>
              <dt>运行环境</dt>
              <dd>{status?.platform ?? "—"}</dd>
            </div>
            <div>
              <dt>开发数据</dt>
              <dd>{status?.dataDirectory ?? "—"}</dd>
            </div>
          </dl>
        )}
      </section>
    </main>
  );
}
