import { invoke } from "@tauri-apps/api/core";
import type { CollectionOverviewInput } from "../generated/collection-overview-input";
import type { OverviewPageInput } from "../generated/overview-page-input";
import type { CollectionOverviewPage } from "../generated/collection-overview-page";
import type { RootOverviewPage } from "../generated/root-overview-page";

const invalid = () => new Error("概览分页数据无效或列表已变化，请重新加载");
function checkCursor(page: { offset: number; totalCount: number; nextOffset: number | null; snapshotToken: string; items: { id: string }[] }, input: OverviewPageInput) {
  const loaded = input.offset + page.items.length;
  if (page.offset !== input.offset || (input.expectedSnapshotToken !== null && page.snapshotToken !== input.expectedSnapshotToken)
    || !Number.isSafeInteger(loaded) || page.items.some(item => !item.id.trim())
    || new Set(page.items.map(item => item.id)).size !== page.items.length
    || (page.items.length > 0 && loaded > page.totalCount)
    || (page.nextOffset === null ? loaded < page.totalCount : page.items.length === 0 || page.nextOffset !== loaded || loaded >= page.totalCount)) throw invalid();
}
export async function readCollectionOverview(input: CollectionOverviewInput): Promise<CollectionOverviewPage> {
  const [{ default: validateInput }, { default: validatePage }] = await Promise.all([
    import("../generated/collection-overview-input.validator.mjs"), import("../generated/collection-overview-page.validator.mjs"),
  ]);
  if (!validateInput(input) || (input.offset > 0 && input.expectedSnapshotToken === null)) throw invalid();
  const page: unknown = await invoke("list_collection_overview", { input });
  if (!validatePage(page) || page.scope !== "collections" || page.rootLinked !== input.rootLinked || page.query !== input.query
    || page.items.some(item => item.systemKey !== null || (item.rootId !== null) !== input.rootLinked)) throw invalid();
  checkCursor(page, input);
  return page;
}
export async function readRootOverview(input: OverviewPageInput): Promise<RootOverviewPage> {
  const [{ default: validateInput }, { default: validatePage }] = await Promise.all([
    import("../generated/overview-page-input.validator.mjs"), import("../generated/root-overview-page.validator.mjs"),
  ]);
  if (!validateInput(input) || (input.offset > 0 && input.expectedSnapshotToken === null)) throw invalid();
  const page: unknown = await invoke("list_root_overview", { input });
  if (!validatePage(page) || page.scope !== "roots") throw invalid();
  checkCursor(page, input);
  return page;
}
