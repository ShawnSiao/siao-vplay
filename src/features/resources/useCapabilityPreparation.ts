import { useCallback, useEffect, useRef, useState } from "react";
import type { LocalResourceStatus } from "../../types";
import { userFacingCommandError } from "../../lib/userFacingError";
import type { PendingResourceAction } from "./pendingResourceAction";

type PendingResourceResume = PendingResourceAction & { resume: () => Promise<void> | void; isCurrent: () => boolean };
type IsCurrentOpening = () => boolean;
type Options = {
  isDesktopApp: boolean;
  localResourceStatus: LocalResourceStatus | null;
  refreshLocalResources: () => Promise<LocalResourceStatus>;
  setToast: (message: string) => void;
};

/** Owns the single pending user intent; resource downloads have an independent lifetime. */
export function useCapabilityPreparation({ isDesktopApp, localResourceStatus, refreshLocalResources, setToast }: Options) {
  const generation = useRef(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; generation.current += 1; };
  }, []);
  const pendingResourceResumeRef = useRef<PendingResourceResume | null>(null);
  const [localResourcesOpen, setLocalResourcesOpen] = useState(false);
  const [pendingResourceAction, setPendingResourceAction] = useState<PendingResourceAction | null>(null);
  const openLocalResources = useCallback(() => {
    generation.current += 1;
    pendingResourceResumeRef.current = null;
    setPendingResourceAction(null);
    setLocalResourcesOpen(true);
    void refreshLocalResources().catch(() => undefined);
  }, [refreshLocalResources]);

  const requestCapability = useCallback(
    async (
      capabilityId: string,
      label: string,
      resume: () => Promise<void> | void,
      profileId?: "fast" | "standard",
      isCurrent: IsCurrentOpening = () => true,
    ) => {
      if (!mounted.current || !isCurrent()) return;
      const identity = ++generation.current;
      const stillCurrent = () => mounted.current && generation.current === identity && isCurrent();
      pendingResourceResumeRef.current = null;
      setPendingResourceAction(null);
      if (!isDesktopApp) {
        await resume();
        return;
      }
      let currentStatus: LocalResourceStatus;
      try {
        currentStatus = await refreshLocalResources();
      } catch (error) {
        if (stillCurrent()) throw error;
        return;
      }
      if (!stillCurrent()) return;
      const capability = currentStatus.capabilities.find(
        (item) => item.id === capabilityId,
      );
      if (capability?.state === "ready") {
        await resume();
        return;
      }
      const pending: PendingResourceResume = {
        id: crypto.randomUUID(),
        capabilityId,
        label,
        profileId,
        resume,
        isCurrent: stillCurrent,
      };
      pendingResourceResumeRef.current = pending;
      setPendingResourceAction({
        id: pending.id,
        capabilityId: pending.capabilityId,
        label: pending.label,
        profileId: pending.profileId,
      });
      setLocalResourcesOpen(true);
    },
    [refreshLocalResources, isDesktopApp],
  );

  const closeLocalResources = useCallback(() => {
    generation.current += 1;
    if (pendingResourceResumeRef.current) {
      setToast("此次操作已取消；已开始的功能准备任务不会被删除。");
    }
    pendingResourceResumeRef.current = null;
    setPendingResourceAction(null);
    setLocalResourcesOpen(false);
  }, [setToast]);

  useEffect(() => {
    const pending = pendingResourceResumeRef.current;
    if (!pending || pending.id !== pendingResourceAction?.id) {
      return;
    }
    const capability = localResourceStatus?.capabilities.find(
      (item) => item.id === pending.capabilityId,
    );
    if (capability?.state !== "ready") {
      return;
    }
    const timer = window.setTimeout(() => {
      if (pendingResourceResumeRef.current?.id !== pending.id) {
        return;
      }
      pendingResourceResumeRef.current = null;
      setPendingResourceAction(null);
      setLocalResourcesOpen(false);
      void Promise.resolve().then(async () => {
        if (!pending.isCurrent()) return;
        setToast(`${pending.label}：所需功能已准备完成。`);
        await pending.resume();
      }).catch((error: unknown) => {
        if (pending.isCurrent()) setToast(userFacingCommandError(error, "settings"));
      });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [localResourceStatus, pendingResourceAction?.id, setToast]);

  return { localResourcesOpen, pendingResourceAction, openLocalResources, closeLocalResources, requestCapability };
}
