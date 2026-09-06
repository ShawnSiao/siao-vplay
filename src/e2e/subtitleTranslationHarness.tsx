import { RecoveryPreview } from "./RecoveryPreview";
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";

import { Dialog } from "../components/Dialog";
import { SubtitleWorkflowTabs, type SubtitleWorkflow } from "../components/SubtitleWorkflowTabs";
import { TranslationLanguageSelectors } from "../components/TranslationLanguageSelectors";
import "../styles.css";

export function SubtitleTranslationHarness() {
  const [workflow, setWorkflow] = useState<SubtitleWorkflow>("import");
  const [sourceLanguage, setSourceLanguage] = useState("ja");
  const [targetLanguage, setTargetLanguage] = useState("zh-cn");
  return (
    <Dialog
      title="准备原文字幕"
      eyebrow="导入已有字幕，或从视频原声生成"
      onClose={() => undefined}
      actions={
        workflow === "translate" ? (
          <button className="button primary" type="button">
            确认范围并开始翻译
          </button>
        ) : null
      }
    >
      <SubtitleWorkflowTabs
        workflow={workflow}
        disabled={false}
        onChange={setWorkflow}
      >
      <div className="subtitle-current-note">
        <span>当前原文字幕</span>
        <strong>本地字幕识别 · 标准</strong>
        <small>JA · 85 条 · 版本 1 · 草稿</small>
      </div>
      {workflow === "translate" ? (
        <div className="translation-setup">
          <TranslationLanguageSelectors
            sourceLanguageCode={sourceLanguage}
            targetLanguageCode={targetLanguage}
            sourceVersionLanguageCode="ja"
            sourceSegmentCount={85}
            selectedCount={85}
            isSelectedRetranslation={false}
            onSourceLanguageChange={setSourceLanguage}
            onTargetLanguageChange={setTargetLanguage}
          />
          <section className="translation-section">
            <h3>选择处理方式</h3>
            <p>可使用本机 Codex，或复制任务提示词交给其他 Agent。</p>
          </section>
        </div>
      ) : null}
      </SubtitleWorkflowTabs>
    </Dialog>
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("Subtitle translation test root is missing.");
createRoot(root).render(
  <StrictMode>
    {new URLSearchParams(location.search).has("recovery") ? <RecoveryPreview remoteUrl={new URLSearchParams(location.search).get("recovery") === "url"} preparation={new URLSearchParams(location.search).get("recovery") === "preparation"} /> : <SubtitleTranslationHarness />}
  </StrictMode>,
);
