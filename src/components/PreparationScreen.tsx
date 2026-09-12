import { useEffect, useState } from "react";
import { openEnvironmentSettings } from "../features/environment-settings/events";

import type { MediaPreparationProgress } from "../lib/mediaPreparationGateway";

import type { Project } from "../types";

type PreparationScreenProps = {
  project: Project;
  forceProxy: boolean;
  error: string | null;
  progress: MediaPreparationProgress | null;
  cancelling: boolean;
  canCancel: boolean;
  onCancel: () => void;
  onRetry: () => void;
  onBack: () => void;
};

export function PreparationScreen({
  project,
  error,
  progress,
  cancelling,
  canCancel,
  onCancel,
  onRetry,
  onBack,
}: PreparationScreenProps) {
  const stageLabels: Record<MediaPreparationProgress["stage"], string> = {
    queued: "等待开始", runtime: "检查播放组件", fingerprint: "核对视频文件",
    inspect: "检查视频与音频", transcode: "生成兼容播放版本", validate: "检查生成的播放版本", finalize: "保存播放版本",
  };
  const stageLabel = cancelling ? "正在停止处理" : progress ? stageLabels[progress.stage] : "正在检查";
  const queued = progress?.stage === "queued";
  const generating = progress?.stage === "transcode";
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  useEffect(() => {
    if (error) return undefined;
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1_000));
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [error, project.id]);

  return (
    <div className="preparation-screen" data-screen-label="准备本地视频">
      <main className="preparation-content">
        <section className="preparation-card" aria-live="polite">
          <p className="eyebrow">{error ? "需要处理" : "正在准备播放"}</p>
          <h1>{error ? "这段视频还不能开始播放" : project.title}</h1>
          <p className="lead">
            {error
              ? "项目和源视频都没有改变。可以重新尝试，或返回项目库重新定位媒体。"
              : cancelling
                ? "正在取消本次准备，请稍候。"
              : queued
                ? "正在等待开始处理。可以返回媒体库，或取消本次准备。"
              : generating
                ? "正在生成兼容的本地播放版本，原片保持不变。"
                : "正在读取音视频轨道并确认当前电脑能否直接播放。"}
          </p>

          {error ? (
            <div className="notice danger">
              <strong>准备失败</strong>
              <p>{error}</p>
            </div>
          ) : (
            <div className="preparation-steps">
              <div className="preparation-step complete">
                <span>1</span>
                <div>
                  <strong>项目已保存</strong>
                  <small>关闭应用后仍可以从项目库继续。</small>
                </div>
                <em>完成</em>
              </div>
              <div className="preparation-step active">
                <span>2</span>
                <div>
                  <strong>
                    {stageLabel}
                  </strong>
                  <small>
                    {cancelling ? "处理停止后可以重新准备播放。" : queued ? "轮到这段视频后会继续准备播放。" : generating
                      ? "原片保持不变，输出保存在 SiaoVPlay 本地缓存。"
                      : "按真实轨道、编码、分辨率和像素格式判断。"}
                  </small>
                </div>
                <em>{cancelling ? "正在停止" : queued ? "等待" : "进行中"}</em>
              </div>
              <div className="preparation-step">
                <span>3</span>
                <div>
                  <strong>打开播放器</strong>
                  <small>确认有有效视频画面后开始观看。</small>
                </div>
                <em>等待</em>
              </div>
            </div>
          )}

          <footer className="preparation-actions">
            <span>处理过程中不会修改或覆盖源视频。</span>
            {error ? (
              <div>
                <button className="button quiet" type="button" onClick={onBack}>
                  返回
                </button>
                <button className="button quiet" type="button" onClick={() => openEnvironmentSettings("storage")}>
                  存储设置
                </button>
                <button className="button primary" type="button" onClick={onRetry}>
                  重新尝试
                </button>
              </div>
            ) : (
              <div>
                <span className="working-indicator">
                  <span className="spinner"></span>
                  {`${cancelling ? "正在停止" : "已用时"} · ${elapsedSeconds} 秒`}
                </span>
                <button className="button quiet" type="button" onClick={onBack}>返回媒体库</button>
                <button className="button quiet" type="button" onClick={onCancel} disabled={!canCancel || cancelling}>
                  {cancelling ? "正在取消…" : "取消并返回媒体库"}
                </button>
              </div>
            )}
          </footer>
        </section>
      </main>
    </div>
  );
}
