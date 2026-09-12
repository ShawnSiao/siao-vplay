import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { listenEnvironmentSettings } from "./events";
import type { EnvironmentSettingsTab } from "./events";

/** The app owns navigation before the settings module is loaded. */
export function useSettingsNavigation(open: () => void) {
  const [tab, setTab] = useState<EnvironmentSettingsTab>("local");
  const latestOpen = useRef(open);
  useLayoutEffect(() => { latestOpen.current = open; }, [open]);
  useEffect(() => listenEnvironmentSettings(next => {
    setTab(next);
    latestOpen.current();
  }), []);
  const openDefault = useCallback(() => {
    setTab("local");
    latestOpen.current();
  }, []);
  return { tab, setTab, openDefault };
}
