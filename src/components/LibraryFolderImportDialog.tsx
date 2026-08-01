import { useMemo } from "react";

import {
  importItemNeedsConfirmation,
  type LibraryFolderImportState,
  type LibraryImportDraftItem,
} from "../features/library/useLibraryController";
import type { EpisodeRecognition } from "../types";
import { Dialog } from "./Dialog";

type LibraryFolderImportDialogProps = {
  state: LibraryFolderImportState;
  onClose: () => void;
  onCancelScan: () => Promise<void>;
  onTitleChange: (title: string) => void;
  onItemChange: (
    candidateId: string,
    values: Partial<
      Pick<
        LibraryImportDraftItem,
        | "displayTitle"
        | "seasonNumber"
        | "episodeNumber"
        | "absoluteOrder"
        | "confirmed"
      >
    >,
  ) => void;
  onConfirmFingerprintDuplicatesChange: (confirmed: boolean) => void;
  onImport: () => Promise<unknown>;
};

const recognitionLabels: Record<EpisodeRecognition, string> = {
  sxx_exx: "S01E02",
  season_x_episode: "1x02",
  chinese_episode: "第 N 集",
  numeric_prefix: "数字前缀",
  season_directory: "季目录",
  unresolved: "未识别",
  conflict: "识别冲突",
};

function optionalPositiveNumber(value: string): number | null {
  if (!value.trim()) {
    return null;
  }
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function nonNegativeInteger(value: string): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function importValidation(state: LibraryFolderImportState) {
  const orders = new Set<number>();
  const errors: string[] = [];
  if (!state.collectionTitle.trim()) {
    errors.push("请填写剧集名称");
  }
  for (const item of state.items) {
    if (!item.displayTitle.trim()) {
      errors.push(`${item.relativePath} 缺少显示标题`);
    }
    if (item.episodeNumber === null || item.episodeNumber <= 0) {
      errors.push(`${item.relativePath} 缺少有效集号`);
    }
    if (item.absoluteOrder < 0 || orders.has(item.absoluteOrder)) {
      errors.push("排序号必须非负且不能重复");
    }
    orders.add(item.absoluteOrder);
    if (importItemNeedsConfirmation(item) && !item.confirmed) {
      errors.push(`${item.relativePath} 尚未确认识别或修正结果`);
    }
  }
  return { valid: state.items.length > 0 && errors.length === 0, errors };
}

export function LibraryFolderImportDialog({
  state,
  onClose,
  onCancelScan,
  onTitleChange,
  onItemChange,
  onConfirmFingerprintDuplicatesChange,
  onImport,
}: LibraryFolderImportDialogProps) {
  const validation = useMemo(() => importValidation(state), [state]);
  const scanning = state.stage === "scanning";
  const importing = state.stage === "importing";
  const preview = state.preview;

  return (
    <Dialog
      eyebrow="文件夹预检"
      title={scanning ? "正在扫描剧集文件夹" : "确认剧集识别结果"}
      onClose={importing ? () => undefined : onClose}
      actions={
        scanning ? (
          <button className="button quiet" type="button" onClick={() => void onCancelScan()}>
            取消扫描
          </button>
        ) : (
          <>
            <button className="button quiet" type="button" disabled={importing} onClick={onClose}>
              取消
            </button>
            <button
              className="button primary"
              type="button"
              disabled={!validation.valid || importing}
              onClick={() => void onImport()}
            >
              {importing ? "正在导入…" : `导入 ${state.items.length} 集`}
            </button>
          </>
        )
      }
    >
      <div className="library-folder-import-dialog">
        {state.error ? (
          <div className="notice danger" role="alert">
            <strong>{preview ? "导入前检查未通过" : "文件夹扫描未完成"}</strong>
            <p>{state.error}</p>
          </div>
        ) : null}

        {scanning ? (
          <div className="library-scan-progress" aria-live="polite">
            <span className="spinner large" />
            <strong>{state.progress?.phase === "fingerprinting" ? "正在核对媒体指纹" : "正在读取文件夹"}</strong>
            <p title={state.progress?.currentRelativePath ?? state.rootPath ?? undefined}>
              {state.progress?.currentRelativePath ?? state.rootPath}
            </p>
            <dl>
              <div><dt>已读目录</dt><dd>{state.progress?.scannedDirectories ?? 0}</dd></div>
              <div><dt>已读文件</dt><dd>{state.progress?.scannedFiles ?? 0}</dd></div>
              <div><dt>视频候选</dt><dd>{state.progress?.candidateFiles ?? 0}</dd></div>
              <div><dt>已忽略</dt><dd>{state.progress?.ignoredEntries ?? 0}</dd></div>
            </dl>
            <small>扫描只读取文件名、大小、修改时间和首尾采样，不复制或修改视频。</small>
          </div>
        ) : preview ? (
          <>
            <div className="library-import-summary">
              <div><strong>{preview.candidates.length}</strong><span>待导入</span></div>
              <div><strong>{preview.ignoredCount}</strong><span>已忽略</span></div>
              <div><strong>{preview.needsConfirmationCount}</strong><span>待确认</span></div>
              <div><strong>30</strong><span>分钟内有效</span></div>
            </div>

            <label className="library-dialog-field">
              <span>剧集名称</span>
              <input
                autoFocus
                maxLength={200}
                value={state.collectionTitle}
                disabled={importing}
                onChange={(event) => onTitleChange(event.target.value)}
              />
            </label>

            <div className="library-import-table" role="table" aria-label="剧集识别结果">
              <div className="library-import-table-head" role="row">
                <span>文件与标题</span><span>季</span><span>集</span><span>顺序</span><span>确认</span>
              </div>
              {state.items.map((item) => {
                const needsConfirmation = importItemNeedsConfirmation(item);
                return (
                  <div
                    className={`library-import-row ${needsConfirmation ? "needs-confirmation" : ""}`}
                    role="row"
                    key={item.candidateId}
                  >
                    <div className="library-import-file">
                      <input
                        aria-label={`${item.relativePath} 显示标题`}
                        value={item.displayTitle}
                        maxLength={200}
                        disabled={importing}
                        onChange={(event) =>
                          onItemChange(item.candidateId, { displayTitle: event.target.value })
                        }
                      />
                      <small title={item.relativePath}>{item.relativePath}</small>
                      <span>{recognitionLabels[item.recognition]}</span>
                      {item.confirmationReason ? <em>{item.confirmationReason}</em> : null}
                    </div>
                    <input
                      aria-label={`${item.relativePath} 季号`}
                      type="number"
                      min="1"
                      step="1"
                      value={item.seasonNumber ?? ""}
                      disabled={importing}
                      onChange={(event) =>
                        onItemChange(item.candidateId, {
                          seasonNumber: optionalPositiveNumber(event.target.value),
                        })
                      }
                    />
                    <input
                      aria-label={`${item.relativePath} 集号`}
                      type="number"
                      min="1"
                      step="1"
                      value={item.episodeNumber ?? ""}
                      disabled={importing}
                      onChange={(event) =>
                        onItemChange(item.candidateId, {
                          episodeNumber: optionalPositiveNumber(event.target.value),
                        })
                      }
                    />
                    <input
                      aria-label={`${item.relativePath} 排序号`}
                      type="number"
                      min="0"
                      step="1"
                      value={item.absoluteOrder}
                      disabled={importing}
                      onChange={(event) =>
                        onItemChange(item.candidateId, {
                          absoluteOrder: nonNegativeInteger(event.target.value),
                        })
                      }
                    />
                    <label className="library-import-confirm">
                      <input
                        aria-label={`确认 ${item.relativePath}`}
                        type="checkbox"
                        checked={item.confirmed}
                        disabled={!needsConfirmation || importing}
                        onChange={(event) =>
                          onItemChange(item.candidateId, { confirmed: event.target.checked })
                        }
                      />
                      <span>{needsConfirmation ? "需确认" : "已识别"}</span>
                    </label>
                  </div>
                );
              })}
            </div>

            <label className="library-import-duplicate-confirm">
              <input
                type="checkbox"
                checked={state.confirmFingerprintDuplicates}
                disabled={importing}
                onChange={(event) =>
                  onConfirmFingerprintDuplicatesChange(event.target.checked)
                }
              />
              <span>
                已人工核对并允许导入「内容指纹相同但路径不同」的视频。默认关闭；只有后端提示重复时才需要开启。
              </span>
            </label>

            {!validation.valid ? (
              <div className="library-import-validation" role="status">
                <strong>还不能导入</strong>
                <span>{validation.errors[0]}</span>
              </div>
            ) : null}

            {preview.ignoredEntries.length ? (
              <details className="library-import-ignored">
                <summary>查看已忽略的 {preview.ignoredCount} 项</summary>
                <ul>
                  {preview.ignoredEntries.map((entry) => (
                    <li key={`${entry.reason}-${entry.relativePath}`}>
                      <span>{entry.relativePath}</span><small>{entry.reason}</small>
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </>
        ) : null}
      </div>
    </Dialog>
  );
}
