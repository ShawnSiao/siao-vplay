import { Dialog } from "./Dialog";

type LibraryImportDialogProps = {
  onClose: () => void;
  onImportFile: () => void;
  onImportFolder: () => void;
  onImportUrl: () => void;
};

export function LibraryImportDialog({
  onClose,
  onImportFile,
  onImportFolder,
  onImportUrl,
}: LibraryImportDialogProps) {
  const choose = (action: () => void) => {
    onClose();
    action();
  };

  return (
    <Dialog
      eyebrow="添加到媒体库"
      title="导入视频"
      onClose={onClose}
      actions={
        <button className="button quiet" type="button" onClick={onClose}>
          取消
        </button>
      }
    >
      <p className="library-import-intro">
        选择已有视频的来源。SiaoVPlay 不提供片源，也不会绕过登录、付费或 DRM 限制。
      </p>
      <div className="library-import-options" aria-label="视频来源">
        <button type="button" onClick={() => choose(onImportFile)}>
          <span aria-hidden="true">▶</span>
          <span>
            <strong>打开本地视频</strong>
            <small>选择一个有权处理的视频文件。</small>
          </span>
        </button>
        <button type="button" onClick={() => choose(onImportFolder)}>
          <span aria-hidden="true">▦</span>
          <span>
            <strong>添加剧集文件夹</strong>
            <small>识别季、集并保留原文件位置。</small>
          </span>
        </button>
        <button type="button" onClick={() => choose(onImportUrl)}>
          <span aria-hidden="true">↗</span>
          <span>
            <strong>从公开链接导入</strong>
            <small>支持公开直链、HLS 和单个公开视频页面。</small>
          </span>
        </button>
      </div>
    </Dialog>
  );
}
