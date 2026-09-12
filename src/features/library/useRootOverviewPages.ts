import { readRootOverview } from "../../lib/libraryOverviewGateway";
import { useOverviewPages } from "./useOverviewPages";
export type RootOverviewReader = typeof readRootOverview;
export function useRootOverviewPages(read: RootOverviewReader = readRootOverview, refreshKey?: unknown) {
  return useOverviewPages(read, refreshKey);
}
