import type { Project } from "../types";

type PreparationScreenProps = {
  project: Project;
  forceProxy: boolean;
  error: string | null;
  onRetry: () => void;
  onBack: () => void;
};

export function PreparationScreen({
  project,
  forceProxy,
  error,
  onRetry,
  onBack,
}: PreparationScreenProps) {
  return (
    <div className="preparation-screen" data-screen-label="准备本地视频">
      <header className="titlebar">
        <div className="brand-lockup">
          <span className="brand-mark" aria-hidden="true">
            V
          </span>
          <span className="brand-name">SiaoVPlay</span>
        </div>
        <span className="titlebar-context">{project.title}</span>
        <button className="button quiet small" type="button" onClick={onBack}>
          返回项目库
        </button>
      </header>
      <main className="preparation-content">
        <section className="preparation-card" aria-live="polite">
          <p className="eyebrow">{error ? "需要处理" : "正在准备播放"}</p>
          <h1>{error ? "这段视频还不能开始播放" : project.title}</h1>
          <p className="lead">
            {error
              ? "项目和源视频都没有改变。可以重新尝试，或返回项目库重新定位媒体。"
              : forceProxy
                ? "检测到原片在当前播放器中没有有效画面，正在生成兼容的本地播放版本。"
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
                    {forceProxy ? "生成兼容播放版本" : "检查视频与音频"}
                  </strong>
                  <small>
                    {forceProxy
                      ? "原片保持不变，输出保存在 SiaoVPlay 本地缓存。"
                      : "按真实轨道、编码、分辨率和像素格式判断。"}
                  </small>
                </div>
                <em>进行中</em>
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
                <button className="button primary" type="button" onClick={onRetry}>
                  重新尝试
                </button>
              </div>
            ) : (
              <span className="working-indicator">
                <span className="spinner"></span>
                请保持应用开启
              </span>
            )}
          </footer>
        </section>
      </main>
    </div>
  );
}
