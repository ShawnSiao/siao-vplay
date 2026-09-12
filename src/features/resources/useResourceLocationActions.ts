import { useCallback, useEffect, useRef, useState } from "react";
import { chooseLocalResourceParent, configureLocalResourceRoot, repairLocalResourceRoot, reconnectLocalResourceRoot, retryLocalResourceBinding, inspectLocalResourceBinding } from "../../lib/desktop";
import type { LocalResourceStatus, LocalResourceLocationPlan, ResourceLocationResult, ResourceDownloadSnapshot } from "../../types";
type Options = { setStatus: (status: LocalResourceStatus) => unknown; adoptSnapshot: (snapshot: ResourceDownloadSnapshot) => unknown; setError: (error: string | null) => void; captureError: (cause: unknown) => unknown };
export function useResourceLocationActions({ setStatus, adoptSnapshot, setError, captureError }: Options) {
  const epoch = useRef(0);
  useEffect(() => () => { epoch.current++; }, []);
  const [bindingRecovery, setBindingRecovery] = useState<ResourceLocationResult | null>(null);
  const accept = useCallback((result: ResourceLocationResult) => {
    setStatus(result); setBindingRecovery(result.bindingError ? result : null);
    if (result.taskSnapshot) adoptSnapshot(result.taskSnapshot);
    return result;
  }, [setStatus, adoptSnapshot]);
  const inspectBinding = useCallback(async () => {
    const attempt = epoch.current; const result = await inspectLocalResourceBinding();
    if (attempt === epoch.current) accept(result);
    return result;
  }, [accept]);
  const apply = async (operation: () => Promise<ResourceLocationResult>) => {
    const attempt = ++epoch.current;
    try { const result = await operation(); if (attempt === epoch.current) { accept(result); setError(null); } return result; }
    catch (cause) { if (attempt === epoch.current) captureError(cause); throw cause; }
  };
  return {
    bindingRecovery, inspectBinding,
    confirmLocation: (plan: LocalResourceLocationPlan) => apply(() => configureLocalResourceRoot(plan)),
    repairRoot: () => apply(repairLocalResourceRoot),
    reconnectRoot: async () => {
      let path: string | null;
      try { path = await chooseLocalResourceParent(); } catch (cause) { captureError(cause); throw cause; }
      return path ? apply(() => reconnectLocalResourceRoot(path)) : null;
    },
    retryBinding: async () => {
      if (!bindingRecovery) throw new Error("没有等待恢复的资源任务状态。");
      try { return await apply(() => retryLocalResourceBinding(bindingRecovery)); }
      catch (cause) { try { await inspectBinding(); } catch { /* Retain the reviewed saved location if inspection also fails. */ } throw cause; }
    },
  };
}
