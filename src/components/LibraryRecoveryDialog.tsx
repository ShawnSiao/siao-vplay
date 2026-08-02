import { useMemo } from "react";

import {
  importItemNeedsConfirmation,
  type LibraryImportDraftItem,
  type LibraryRecoveryState,
} from "../features/library/useLibraryController";
import type { RelocationMismatchReason } from "../types";
import { Dialog } from "./Dialog";

type EditableValues = Partial<
  Pick<
    LibraryImportDraftItem,
    | "displayTitle"
    | "seasonNumber"
    | "episodeNumber"
    | "absoluteOrder"
    | "confirmed"
  >
>;

type LibraryRecoveryDialogProps = {
  state: LibraryRecoveryState;
  onClose: () => void;
  onItemChange: (candidateId: string, values: EditableValues) => void;
  onConfirmationChange: (
    field:
      | "confirmMissing"
      | "confirmChanged"
      | "confirmUncertainMatches"
      | "confirmFingerprintDuplicates",
    checked: boolean,
  ) => void;
  onRebuildTitleChange: (title: string) => void;
  onApplyRescan: () => Promise<unknown>;
  onApplyRebuild: () => Promise<unknown>;
  onApplyRelocation: () => Promise<unknown>;
};

const mismatchLabels: Record<RelocationMismatchReason, string> = {
  missing: "新目录缺少文件",
  fingerprint_changed: "内容指纹不一致",
  invalid_relative_path: "既有相对路径无效",
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

function validateRescan(state: LibraryRecoveryState) {
  const preview = state.rescanPreview;
  if (!preview) {
    return { valid: false, errors: [] as string[] };
  }
  const errors: string[] = [];
  const orders = new Set<number>();
  for (const item of state.newItems) {
    if (!item.displayTitle.trim()) {
      errors.push(`${item.relativePath} 缺少显示标题`);
    }
    if (item.episodeNumber === null || item.episodeNumber <= 0) {
      errors.push(`${item.relativePath} 缺少有效集号`);
    }
    if (item.absoluteOrder < 0 || orders.has(item.absoluteOrder)) {
      errors.push("新增单集的排序号必须非负且不能重复");
    }
    orders.add(item.absoluteOrder);
    if (importItemNeedsConfirmation(item) && !item.confirmed) {
      errors.push(`${item.relativePath} 尚未确认识别或修正结果`);
    }
  }
  if ((preview.rootOffline || preview.missingItems.length > 0) && !state.confirmMissing) {
    errors.push(
      preview.rootOffline
        ? "尚未确认将根目录及全部单集标记为离线"
        : "尚未确认保留缺失单集的既有资料",
    );
  }
  if (preview.changedItems.length > 0 && !state.confirmChanged) {
    errors.push("尚未确认将同路径内容变化标记为已变更");
  }
  if (
    state.newItems.some((item) => item.confirmationReason?.includes("内容指纹")) &&
    !state.confirmFingerprintDuplicates
  ) {
    errors.push("尚未允许导入已人工确认的相同内容指纹文件");
  }
  return { valid: errors.length === 0, errors };
}

function validateRebuild(state: LibraryRecoveryState) {
  const preview = state.rebuildPreview;
  if (!preview) {
    return { valid: false, errors: [] as string[] };
  }
  const errors: string[] = [];
  if (!state.rebuildCollectionTitle.trim()) {
    errors.push("剧集名称不能为空");
  }
  const orders = new Set<number>();
  for (const item of state.newItems) {
    if (!item.displayTitle.trim()) {
      errors.push(`${item.relativePath} 缺少显示标题`);
    }
    if (item.episodeNumber === null || item.episodeNumber <= 0) {
      errors.push(`${item.relativePath} 缺少有效集号`);
    }
    if (item.absoluteOrder < 0 || orders.has(item.absoluteOrder)) {
      errors.push("新增视频的排序号必须非负且不能重复");
    }
    orders.add(item.absoluteOrder);
    if (importItemNeedsConfirmation(item) && !item.confirmed) {
      errors.push(`${item.relativePath} 尚未确认识别或修正结果`);
    }
  }
  if (preview.rootOffline) {
    errors.push("当前选择的位置不可用，请重新选择文件夹");
  }
  if (preview.missingItems.length > 0 && !state.confirmMissing) {
    errors.push("尚未确认保留缺失视频的既有资料");
  }
  if (preview.changedItems.length > 0 && !state.confirmChanged) {
    errors.push("尚未确认将内容变化的视频作为原项目重建");
  }
  if (preview.uncertainItems.length > 0 && !state.confirmUncertainMatches) {
    errors.push("尚未确认历史清单中无法自动确认的视频匹配");
  }
  if (
    state.newItems.some((item) => item.confirmationReason?.includes("内容指纹")) &&
    !state.confirmFingerprintDuplicates
  ) {
    errors.push("尚未允许导入已人工确认的相同内容指纹视频");
  }
  return { valid: errors.length === 0, errors };
}

export function LibraryRecoveryDialog({
  state,
  onClose,
  onItemChange,
  onConfirmationChange,
  onRebuildTitleChange,
  onApplyRescan,
  onApplyRebuild,
  onApplyRelocation,
}: LibraryRecoveryDialogProps) {
  const validation = useMemo(
    () => (state.rebuildPreview ? validateRebuild(state) : validateRescan(state)),
    [state],
  );
  const inspecting = state.stage.startsWith("inspecting_");
  const applying = state.stage === "applying";
  const rescan = state.rescanPreview;
  const rebuild = state.rebuildPreview;
  const relocation = state.relocationPreview;
  const relocationValid = Boolean(relocation && relocation.mismatches.length === 0);
  const hasFingerprintDuplicates = state.newItems.some((item) =>
    item.confirmationReason?.includes("内容指纹"),
  );

  return (
    <Dialog
      eyebrow="媒体库恢复"
      title={
        rescan
          ? "确认重新扫描结果"
          : rebuild
            ? "确认重建剧集结果"
          : relocation
            ? "确认根目录重定位"
            : state.stage === "inspecting_relocation"
              ? "正在检查新根目录"
              : "正在重新扫描文件夹"
      }
      onClose={applying ? () => undefined : onClose}
      actions={
        inspecting || state.stage === "error" ? (
          <button className="button quiet" type="button" onClick={onClose}>关闭</button>
        ) : (
          <>
            <button className="button quiet" type="button" disabled={applying} onClick={onClose}>
              取消
            </button>
            {rescan ? (
              <button
                className="button primary"
                type="button"
                disabled={!validation.valid || applying}
                onClick={() => void onApplyRescan()}
              >
                {applying ? "正在应用…" : "应用扫描结果"}
              </button>
            ) : rebuild ? (
              <button
                className="button primary"
                type="button"
                disabled={!validation.valid || applying}
                onClick={() => void onApplyRebuild()}
              >
                {applying ? "正在创建剧集…" : "创建剧集"}
              </button>
            ) : (
              <button
                className="button primary"
                type="button"
                disabled={!relocationValid || applying}
                onClick={() => void onApplyRelocation()}
              >
                {applying ? "正在重定位…" : "更新根目录"}
              </button>
            )}
          </>
        )
      }
    >
      <div className="library-recovery-dialog">
        {state.error ? (
          <div className="notice danger" role="alert">
            <strong>媒体库恢复检查未通过</strong>
            <p>{state.error}</p>
          </div>
        ) : null}
        {inspecting ? (
          <div className="library-scan-progress" aria-live="polite">
            <span className="spinner large" />
            <strong>{state.stage === "inspecting_relocation" ? "正在核对相对路径和内容指纹" : state.stage === "inspecting_rebuild" ? "正在匹配历史项目与文件夹内容" : "正在比较文件夹与媒体库记录"}</strong>
            <small>检查只读取文件元数据和首尾采样，不修改源视频。</small>
          </div>
        ) : rebuild ? (
          <>
            <div className="library-import-summary">
              <div><strong>{rebuild.matchedItems.length}</strong><span>匹配</span></div>
              <div><strong>{rebuild.newCandidates.length}</strong><span>可新增</span></div>
              <div><strong>{rebuild.missingItems.length}</strong><span>缺失</span></div>
              <div><strong>{rebuild.changedItems.length + rebuild.uncertainItems.length}</strong><span>需确认</span></div>
            </div>
            <label className="library-dialog-field"><span>新剧集名称</span><input value={state.rebuildCollectionTitle} disabled={applying} onChange={(event) => onRebuildTitleChange(event.target.value)} /></label>
            <p className="library-recovery-path" title={rebuild.rootPath}>{rebuild.rootPath}</p>
            {rebuild.rootOffline ? (
              <div className="notice warning"><strong>文件夹当前不可用</strong><p>请选择一个可用位置后重新执行「选择位置并重建」。</p></div>
            ) : null}
            {state.newItems.length > 0 ? (
              <section className="library-recovery-section">
                <h3>可新增视频</h3>
                <div className="library-import-table" role="table" aria-label="可新增视频识别结果">
                  <div className="library-import-table-head" role="row"><span>文件与标题</span><span>季</span><span>集</span><span>顺序</span><span>确认</span></div>
                  {state.newItems.map((item) => {
                    const needsConfirmation = importItemNeedsConfirmation(item);
                    return <div className={`library-import-row ${needsConfirmation ? "needs-confirmation" : ""}`} role="row" key={item.candidateId}>
                      <div className="library-import-file"><input aria-label={`${item.relativePath} 显示标题`} value={item.displayTitle} disabled={applying} onChange={(event) => onItemChange(item.candidateId, { displayTitle: event.target.value })} /><small>{item.relativePath}</small>{item.confirmationReason ? <em>{item.confirmationReason}</em> : null}</div>
                      <input aria-label={`${item.relativePath} 季号`} type="number" min="1" value={item.seasonNumber ?? ""} disabled={applying} onChange={(event) => onItemChange(item.candidateId, { seasonNumber: optionalPositiveNumber(event.target.value) })} />
                      <input aria-label={`${item.relativePath} 集号`} type="number" min="1" value={item.episodeNumber ?? ""} disabled={applying} onChange={(event) => onItemChange(item.candidateId, { episodeNumber: optionalPositiveNumber(event.target.value) })} />
                      <input aria-label={`${item.relativePath} 排序号`} type="number" min="0" value={item.absoluteOrder} disabled={applying} onChange={(event) => onItemChange(item.candidateId, { absoluteOrder: nonNegativeInteger(event.target.value) })} />
                      <label className="library-import-confirm"><input aria-label={`确认 ${item.relativePath}`} type="checkbox" checked={item.confirmed} disabled={!needsConfirmation || applying} onChange={(event) => onItemChange(item.candidateId, { confirmed: event.target.checked })} /><span>{needsConfirmation ? "需确认" : "已识别"}</span></label>
                    </div>;
                  })}
                </div>
              </section>
            ) : null}
            {rebuild.missingItems.length > 0 ? <RecoveryItems title="缺失视频" items={rebuild.missingItems.map((item) => `${item.displayTitle} · ${item.relativePath}`)} /> : null}
            {rebuild.changedItems.length > 0 ? <RecoveryItems title="内容变化" items={rebuild.changedItems.map((item) => `${item.displayTitle} · ${item.relativePath}`)} /> : null}
            {rebuild.uncertainItems.length > 0 ? <RecoveryItems title="需要人工确认的匹配" items={rebuild.uncertainItems.map((item) => `${item.displayTitle} · ${item.relativePath}${item.reason ? ` · ${item.reason}` : ""}`)} /> : null}
            <div className="library-recovery-confirmations">
              {rebuild.missingItems.length > 0 ? <label><input type="checkbox" checked={state.confirmMissing} disabled={applying} onChange={(event) => onConfirmationChange("confirmMissing", event.target.checked)} /><span>保留缺失视频的字幕、进度和学习资料</span></label> : null}
              {rebuild.changedItems.length > 0 ? <label><input type="checkbox" checked={state.confirmChanged} disabled={applying} onChange={(event) => onConfirmationChange("confirmChanged", event.target.checked)} /><span>将内容变化的视频作为原项目重建</span></label> : null}
              {rebuild.uncertainItems.length > 0 ? <label><input type="checkbox" checked={state.confirmUncertainMatches} disabled={applying} onChange={(event) => onConfirmationChange("confirmUncertainMatches", event.target.checked)} /><span>确认历史清单中无法自动确认的视频匹配</span></label> : null}
              {hasFingerprintDuplicates ? <label><input type="checkbox" checked={state.confirmFingerprintDuplicates} disabled={applying} onChange={(event) => onConfirmationChange("confirmFingerprintDuplicates", event.target.checked)} /><span>允许导入已确认的相同内容指纹、不同路径视频</span></label> : null}
            </div>
            {!validation.valid ? <div className="library-import-validation" role="status"><strong>还不能创建剧集</strong><ul>{validation.errors.slice(0, 4).map((error) => <li key={error}>{error}</li>)}</ul></div> : null}
          </>
        ) : rescan ? (
          <>
            <div className="library-import-summary">
              <div><strong>{rescan.newCandidates.length}</strong><span>新增</span></div>
              <div><strong>{rescan.missingItems.length}</strong><span>缺失</span></div>
              <div><strong>{rescan.changedItems.length}</strong><span>已变更</span></div>
              <div><strong>{rescan.availableItemCount}</strong><span>正常</span></div>
            </div>
            <p className="library-recovery-path" title={rescan.rootPath}>{rescan.rootPath}</p>
            {rescan.rootOffline ? (
              <div className="notice warning">
                <strong>根目录当前离线</strong>
                <p>应用后只标记离线，不删除项目、字幕、进度或学习资料。</p>
              </div>
            ) : null}
            {state.newItems.length > 0 ? (
              <section className="library-recovery-section">
                <h3>新增单集</h3>
                <div className="library-import-table" role="table" aria-label="新增单集识别结果">
                  <div className="library-import-table-head" role="row">
                    <span>文件与标题</span><span>季</span><span>集</span><span>顺序</span><span>确认</span>
                  </div>
                  {state.newItems.map((item) => {
                    const needsConfirmation = importItemNeedsConfirmation(item);
                    return (
                      <div className={`library-import-row ${needsConfirmation ? "needs-confirmation" : ""}`} role="row" key={item.candidateId}>
                        <div className="library-import-file">
                          <input aria-label={`${item.relativePath} 显示标题`} value={item.displayTitle} disabled={applying} onChange={(event) => onItemChange(item.candidateId, { displayTitle: event.target.value })} />
                          <small>{item.relativePath}</small>
                          {item.confirmationReason ? <em>{item.confirmationReason}</em> : null}
                        </div>
                        <input aria-label={`${item.relativePath} 季号`} type="number" min="1" value={item.seasonNumber ?? ""} disabled={applying} onChange={(event) => onItemChange(item.candidateId, { seasonNumber: optionalPositiveNumber(event.target.value) })} />
                        <input aria-label={`${item.relativePath} 集号`} type="number" min="1" value={item.episodeNumber ?? ""} disabled={applying} onChange={(event) => onItemChange(item.candidateId, { episodeNumber: optionalPositiveNumber(event.target.value) })} />
                        <input aria-label={`${item.relativePath} 排序号`} type="number" min="0" value={item.absoluteOrder} disabled={applying} onChange={(event) => onItemChange(item.candidateId, { absoluteOrder: nonNegativeInteger(event.target.value) })} />
                        <label className="library-import-confirm">
                          <input aria-label={`确认 ${item.relativePath}`} type="checkbox" checked={item.confirmed} disabled={!needsConfirmation || applying} onChange={(event) => onItemChange(item.candidateId, { confirmed: event.target.checked })} />
                          <span>{needsConfirmation ? "需确认" : "已识别"}</span>
                        </label>
                      </div>
                    );
                  })}
                </div>
              </section>
            ) : null}
            {rescan.missingItems.length > 0 ? (
              <RecoveryItems title="缺失文件" items={rescan.missingItems.map((item) => `${item.displayTitle} · ${item.relativePath}`)} />
            ) : null}
            {rescan.changedItems.length > 0 ? (
              <RecoveryItems title="同路径内容变化" items={rescan.changedItems.map((item) => `${item.displayTitle} · ${item.relativePath}`)} />
            ) : null}
            <div className="library-recovery-confirmations">
              {(rescan.rootOffline || rescan.missingItems.length > 0) ? (
                <label><input type="checkbox" checked={state.confirmMissing} disabled={applying} onChange={(event) => onConfirmationChange("confirmMissing", event.target.checked)} /><span>{rescan.rootOffline ? "确认将根目录与全部单集标记为离线，并保留全部资料" : "确认将缺失文件标记为缺失，并保留全部资料"}</span></label>
              ) : null}
              {rescan.changedItems.length > 0 ? (
                <label><input type="checkbox" checked={state.confirmChanged} disabled={applying} onChange={(event) => onConfirmationChange("confirmChanged", event.target.checked)} /><span>确认标记内容已变更，不覆盖原项目或既有资料</span></label>
              ) : null}
              {hasFingerprintDuplicates ? (
                <label><input type="checkbox" checked={state.confirmFingerprintDuplicates} disabled={applying} onChange={(event) => onConfirmationChange("confirmFingerprintDuplicates", event.target.checked)} /><span>允许导入已人工确认的相同内容指纹、不同路径文件</span></label>
              ) : null}
            </div>
            {!validation.valid ? (
              <div className="library-import-validation" role="status">
                <strong>还不能应用</strong>
                <ul>{validation.errors.slice(0, 4).map((error) => <li key={error}>{error}</li>)}</ul>
              </div>
            ) : null}
          </>
        ) : relocation ? (
          <>
            <div className="library-relocation-paths">
              <div><span>原目录</span><strong>{relocation.currentRootPath}</strong></div>
              <div><span>新目录</span><strong>{relocation.newRootPath}</strong></div>
            </div>
            <div className="library-import-summary compact">
              <div><strong>{relocation.matchedItemCount}</strong><span>匹配</span></div>
              <div><strong>{relocation.mismatches.length}</strong><span>不一致</span></div>
            </div>
            {relocation.mismatches.length > 0 ? (
              <section className="library-recovery-section">
                <h3>不能重定位的文件</h3>
                <ul className="library-recovery-items">
                  {relocation.mismatches.map((item) => (
                    <li key={`${item.projectId}-${item.relativePath}`}><strong>{item.relativePath}</strong><span>{mismatchLabels[item.reason]}</span></li>
                  ))}
                </ul>
                <p>修正新目录后重新检查。不会更新任何文件定位信息。</p>
              </section>
            ) : (
              <div className="notice success"><strong>全部相对路径与内容指纹一致</strong><p>应用后只更新根目录和媒体定位，保留项目版本、字幕、进度、探测缓存和学习资料。</p></div>
            )}
          </>
        ) : null}
      </div>
    </Dialog>
  );
}

function RecoveryItems({ title, items }: { title: string; items: string[] }) {
  return (
    <section className="library-recovery-section">
      <h3>{title}</h3>
      <ul className="library-recovery-items">{items.map((item) => <li key={item}>{item}</li>)}</ul>
    </section>
  );
}
