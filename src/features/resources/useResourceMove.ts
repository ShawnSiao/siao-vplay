import { invoke } from "@tauri-apps/api/core";
import { useRef, useState } from "react";
import { moveLocalResourceRoot } from "../../lib/desktop";

export function useResourceMove(onMoved: () => Promise<void>, onError: (error: unknown) => void) {
  const activeId = useRef<string | null>(null);
  const [moving, setMoving] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const move = async (parentPath: string) => {
    if (activeId.current) throw new Error("已有资源复制正在进行。");
    const id = crypto.randomUUID();
    activeId.current = id;
    setMoving(true);
    setCancelling(false);
    try {
      const result = await moveLocalResourceRoot(parentPath, id);
      await onMoved();
      return result;
    } catch (error) {
      onError(error);
      throw error;
    } finally {
      if (activeId.current === id) {
        activeId.current = null;
        setMoving(false);
        setCancelling(false);
      }
    }
  };
  const cancel = async () => {
    const id = activeId.current;
    if (!id) return false;
    const accepted = await invoke<boolean>("cancel_local_resource_move", { requestId: id });
    if (activeId.current === id) setCancelling(accepted);
    return accepted;
  };
  return { moving, cancelling, move, cancel };
}
