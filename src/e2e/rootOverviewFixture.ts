import type { LibraryRootSummary } from "../types";
import type { RootOverviewReader } from "../features/library/useRootOverviewPages";

export function rootOverviewFixture(template: LibraryRootSummary): RootOverviewReader {
  const params = new URLSearchParams(location.search);
  const count = ["26", "1000", "10000"].includes(params.get("rootCount") ?? "") ? Number(params.get("rootCount")) : 1;
  let failed = false;
  return async input => {
    if (params.has("root-retry") && !failed && input.offset === 24) {
      failed = true; throw new Error("测试：文件夹读取暂时失败");
    }
    const items = Array.from({ length: Math.min(24, Math.max(0, count - input.offset)) }, (_, i) => {
      const index = input.offset + i;
      return count === 1 ? template : { ...template, id: `root-${index}`, displayName: `目录 ${index + 1}`, path: `W:\\示例\\目录 ${index + 1}`,
        status: (index % 5 === 4 ? "ambiguous" : index % 5 >= 2 ? "orphaned" : "linked") as LibraryRootSummary["status"],
        availability: (index % 5 === 1 || index % 5 === 3 ? "offline" : "available") as LibraryRootSummary["availability"],
      };
    });
    return { scope: "roots", offset: input.offset, snapshotToken: "a".repeat(64), totalCount: count,
      nextOffset: input.offset + items.length < count ? input.offset + items.length : null, items };
  };
}
