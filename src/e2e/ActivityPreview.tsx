import { useState } from "react";
import { AppToast, type ToastNotice } from "../components/AppToast";
import { SummaryActivityMenu } from "../features/summary/SummaryActivityMenu";

export function ActivityPreview() {
  const [notice, setNotice] = useState<ToastNotice | null>(null);
  return <>
    <SummaryActivityMenu onNotice={setNotice} onOpen={(result) => setNotice(`已选择视频：${result.title}`)} />
    {notice ? <AppToast notice={notice} onDismiss={() => setNotice(null)} /> : null}
  </>;
}
