import type { LocalResourceDiagnostics } from "../../generated/local-resource-diagnostics";

type Props = { diagnostic: LocalResourceDiagnostics["maintenance"] };
export function ResourceMaintenanceNotice({ diagnostic }: Props) {
  const { transactionState, scanState, stagingReviewCount, receiptRecoveryCopyCount } = diagnostic;
  const pending = transactionState === "activation_pending" || transactionState === "removal_pending";
  return (
    <section className="notice" aria-label="资源变更与备份检查">
      <strong>资源变更与备份检查</strong>
      {pending ? <p>检测到尚未完成的资源变更记录。请先关闭占用资源的程序，再重试原操作；恢复失败时请保留文件并反馈诊断摘要。</p> : null}
      {transactionState === "conflicting" ? <p>检测到相互冲突的资源变更记录。请保留文件并反馈诊断摘要，不要手动删除或覆盖。</p> : null}
      {transactionState === "unavailable" ? <p>无法检查资源变更记录。请检查数据目录是否可访问，当前不能确认变更已完成。</p> : null}
      {stagingReviewCount > 0 || receiptRecoveryCopyCount > 0 ? <p>
        发现 {stagingReviewCount} 项暂存备份、{receiptRecoveryCopyCount} 项安装记录备份需要核对。
        这些文件可能用于恢复，尚未确认归属，本次检查不会删除它们。
      </p> : null}
      {scanState === "partial" ? <p>本次检查未完成，以上数量仅为已检查部分。可能达到扫描上限或存在无法访问的目录，请保留文件并反馈诊断摘要。</p> : null}
      {scanState === "root_unavailable" ? <p>资源目录不可访问，尚未检查备份文件。</p> : null}
      {scanState === "not_configured" ? <p>尚未配置资源目录。</p> : null}
      {transactionState === "none" && scanState === "complete" && stagingReviewCount === 0 && receiptRecoveryCopyCount === 0 ? <p>本次检查未发现待处理的变更记录或备份文件。</p> : null}
    </section>
  );
}
