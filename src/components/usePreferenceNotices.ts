import { useEffect } from "react";
import { subscribePreferenceFailures } from "../lib/preferenceNotice";
import type { ToastNotice } from "./AppToast";

export function usePreferenceNotices(onNotice: (notice: ToastNotice) => void) {
  useEffect(() => subscribePreferenceFailures((failure) => {
    onNotice({
      tone: "warning",
      title: "设置未保存",
      message: failure === "unsupported-version"
        ? "已保留其他版本的设置，本次更改仅临时生效。"
        : "无法保存设置，本次更改仅临时生效。",
    });
  }), [onNotice]);
}
