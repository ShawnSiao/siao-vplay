import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";

import { Dialog } from "../components/Dialog";
import "../styles.css";

export function DialogHarness() {
  const [open, setOpen] = useState(true);

  return (
    <main>
      <button type="button" onClick={() => setOpen(true)}>
        打开可读性检查
      </button>
      {open ? (
        <Dialog
          title="字幕导入检查"
          eyebrow="900 px 窗口布局"
          onClose={() => setOpen(false)}
          actions={
            <>
              <button className="button quiet" type="button">
                取消
              </button>
              <button className="button primary" type="button">
                确认导入
              </button>
            </>
          }
        >
          <p>正文用于说明字幕导入结果，字号不得低于 13 px。</p>
          <small>辅助文字用于展示文件与检测状态，字号不得低于 12 px。</small>
          <label className="field">
            <span>字幕名称</span>
            <input defaultValue="第一集原文字幕" />
          </label>
          {Array.from({ length: 36 }, (_, index) => (
            <p key={index}>第 {index + 1} 条字幕预览内容，仅正文区域滚动。</p>
          ))}
        </Dialog>
      ) : null}
    </main>
  );
}

const root = document.getElementById("root");
if (!root) {
  throw new Error("Dialog test root is missing.");
}

createRoot(root).render(
  <StrictMode>
    <DialogHarness />
  </StrictMode>,
);
