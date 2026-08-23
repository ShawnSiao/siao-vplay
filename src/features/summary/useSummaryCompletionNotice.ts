import { useEffect, useRef } from "react";

import { isDesktopApp } from "../../lib/desktop";
import { listSummaryTasks } from "./gateway";

export function useSummaryCompletionNotice(
  projectId: string,
  onNotice: (message: string) => void,
) {
  const initializedRef = useRef(false);
  const completedRef = useRef(new Set<string>());
  const onNoticeRef = useRef(onNotice);

  useEffect(() => {
    onNoticeRef.current = onNotice;
  }, [onNotice]);

  useEffect(() => {
    initializedRef.current = false;
    completedRef.current = new Set();
    if (!isDesktopApp) return;
    let active = true;
    const poll = async () => {
      try {
        const tasks = await listSummaryTasks(projectId);
        if (!active) return;
        const completed = tasks.filter(
          (task) => task.status === "completed" && Boolean(task.outputSummaryId),
        );
        if (initializedRef.current) {
          const fresh = completed.find((task) => !completedRef.current.has(task.id));
          if (fresh) {
            onNoticeRef.current("视频总结已完成，可在「理解 → 视频总结」中查看和导出。");
          }
        }
        completedRef.current = new Set(completed.map((task) => task.id));
        initializedRef.current = true;
      } catch {
        // 后台提示失败不影响播放器与总结任务本身。
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 2_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [projectId]);
}
