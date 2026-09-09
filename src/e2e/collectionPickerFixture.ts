import type { CollectionSummary } from "../types";
import type { CollectionOverviewReader } from "../features/library/useCollectionOverviewPages";

export function collectionPickerFixture(template: CollectionSummary): CollectionOverviewReader {
  const params = new URLSearchParams(location.search);
  const count = ["1000", "10000"].includes(params.get("collectionCount") ?? "") ? Number(params.get("collectionCount")) : 1;
  let failed = false;
  return async input => {
    if (params.has("picker-retry") && !failed && input.offset === 24 && !input.query) {
      failed = true; throw new Error("测试：读取暂时失败");
    }
    const rows = Array.from({ length: input.rootLinked ? 2 : count }, (_, i) => ({ ...template,
      id: `${input.rootLinked ? "folder" : "manual"}-${i}`,
      rootId: input.rootLinked ? "fixture-root" : null,
      title: input.rootLinked ? `文件夹合集 ${i + 1}` : count === 1 ? template.title : `自建合集 ${i + 1}`,
    })).filter(item => item.title.toLowerCase().includes(input.query.toLowerCase()));
    const items = rows.slice(input.offset, input.offset + 24);
    const loaded = input.offset + items.length;
    return { scope: "collections", rootLinked: input.rootLinked, query: input.query, offset: input.offset,
      snapshotToken: "a".repeat(64), totalCount: rows.length, nextOffset: loaded < rows.length ? loaded : null, items };
  };
}
