import type { SummaryExport } from "../../generated/summary-export";

const unconfirmed = () => new Error("报告导出已返回，但保存结果尚未确认。请先检查所选目录，避免重复导出。");
const normalize = (path: string) => path.replace(/\\/g, "/").replace(/\/+$/, "");

export async function parseSummaryExport(value: unknown, summaryId: string, selectedDirectory: string): Promise<SummaryExport> {
  let valid: boolean;
  try {
    const { default: validate } = await import("../../generated/summary-export.validator.mjs");
    valid = validate(value);
  } catch { throw unconfirmed(); }
  if (!valid) throw unconfirmed();
  const receipt = value as SummaryExport;
  const directory = normalize(receipt.directory);
  const parent = normalize(selectedDirectory.trim());
  const leaf = directory.slice(parent.length + 1);
  if (receipt.summaryId !== summaryId || !summaryId.trim() || !parent ||
      !directory.startsWith(`${parent}/`) || !leaf || leaf.includes("/") || leaf === "." || leaf === ".." ||
      normalize(receipt.reportPath) !== `${directory}/report.md` ||
      normalize(receipt.manifestPath) !== `${directory}/manifest.json`) throw unconfirmed();
  return receipt;
}
