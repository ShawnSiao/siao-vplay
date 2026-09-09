import { useEffect, useRef, useState } from "react";
import type { ToastNotice } from "../../components/AppToast";
import { isDesktopApp } from "../../lib/desktop";
import { listSummaryActivity, type SummaryActivity } from "./activityGateway";

export function useSummaryCompletionNotice(onNotice: (message: ToastNotice) => void) {
  const [activities, setActivities] = useState<SummaryActivity[]>([]);
  const [error, setError] = useState(false);
  const [incomplete, setIncomplete] = useState(false);
  const onNoticeRef = useRef(onNotice);
  useEffect(() => { onNoticeRef.current = onNotice; }, [onNotice]);
  useEffect(() => {
    if (!isDesktopApp) return;
    let active = true;
    let polling = false;
    let initialized = false;
    const seen = new Map<string, string>();
    const poll = async () => {
      if (polling) return;
      polling = true;
      try {
        const snapshot = await listSummaryActivity();
        const tasks = snapshot.activities;
        if (!active) return;
        const fresh = tasks.filter((task) => seen.get(task.id) !== `${task.status}:${task.hasResult}` &&
          ((task.status === "completed" && task.hasResult) || task.status === "failed" || task.status === "interrupted"));
        if (initialized && fresh.length) {
          const failures = fresh.some((task) => task.status !== "completed");
          onNoticeRef.current({
            title: fresh.length === 1 ? `「${fresh[0].projectTitle}」的总结${failures ? "需要处理" : "已完成"}` : `${fresh.length} 项视频总结有新动态`,
            message: "可从「处理动态」返回对应视频，在「理解 → 视频总结」中查看或重试。",
            tone: failures ? "warning" : "success",
          });
        }
        // Keep notification history across rejected rows, bounded to the activity window.
        if (!snapshot.incomplete) seen.clear();
        for (const task of tasks) {
          seen.delete(task.id);
          seen.set(task.id, `${task.status}:${task.hasResult}`);
        }
        while (seen.size > 100) seen.delete(seen.keys().next().value!);
        initialized = true;
        setActivities(tasks);
        setIncomplete(snapshot.incomplete);
        setError(false);
      } catch { if (active) setError(true); }
      finally { polling = false; }
    };
    void poll();
    const timer = window.setInterval(() => { void poll(); }, 2000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);
  return { activities, error, incomplete };
}
