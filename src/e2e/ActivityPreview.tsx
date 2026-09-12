import { useState } from "react";
import { AppToast, type ToastNotice } from "../components/AppToast";
import { SummaryActivityMenu } from "../features/summary/SummaryActivityMenu";

export function ActivityPreview() {
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [notice, setNotice] = useState<ToastNotice | null>(null);
  return <>
    <SummaryActivityMenu onNotice={setNotice} onOpen={(result) => { setSelectedProjectId(result.projectId); setNotice(`已选择视频：${result.title}`); }} />
    <output data-testid="activity-selected-project">{selectedProjectId}</output>
    {notice ? <AppToast notice={notice} onDismiss={() => setNotice(null)} /> : null}
  </>;
}
