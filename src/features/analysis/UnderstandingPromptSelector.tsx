import { useEffect, useMemo, useState } from "react";

import {
  deleteAnalysisPromptTemplate,
  listAnalysisPromptTemplates,
  saveAnalysisPromptTemplate,
} from "./gateway";
import type { AnalysisPromptTemplate, PromptSelection } from "./types";

const DEFAULT_TEMPLATE_ID = "builtin:understanding:balanced";

type UnderstandingPromptSelectorProps = {
  value: PromptSelection;
  disabled: boolean;
  onChange: (value: PromptSelection) => void;
  onError: (cause: unknown) => void;
};

export function UnderstandingPromptSelector({
  value,
  disabled,
  onChange,
  onError,
}: UnderstandingPromptSelectorProps) {
  const [templates, setTemplates] = useState<AnalysisPromptTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showSave, setShowSave] = useState(false);
  const [templateName, setTemplateName] = useState("");

  useEffect(() => {
    let active = true;
    void listAnalysisPromptTemplates("understanding")
      .then((items) => {
        if (!active) {
          return;
        }
        setTemplates(items);
      })
      .catch(onError)
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [onError]);

  const selected = useMemo(
    () => templates.find((item) => item.id === value.templateId) ?? null,
    [templates, value.templateId],
  );

  const savePersonal = async () => {
    if (!selected || !templateName.trim() || !value.oneTimeRequirements.trim()) {
      return;
    }
    setSaving(true);
    try {
      const created = await saveAnalysisPromptTemplate({
        id: null,
        taskType: "understanding",
        baseTemplateId: selected.isBuiltin
          ? selected.id
          : selected.baseTemplateId,
        name: templateName.trim(),
        customRequirements: value.oneTimeRequirements.trim(),
      });
      setTemplates((current) => [...current, created]);
      onChange({ templateId: created.id, oneTimeRequirements: "" });
      setTemplateName("");
      setShowSave(false);
    } catch (cause) {
      onError(cause);
    } finally {
      setSaving(false);
    }
  };

  const removePersonal = async () => {
    if (!selected || selected.isBuiltin) {
      return;
    }
    setSaving(true);
    try {
      await deleteAnalysisPromptTemplate(selected.id);
      setTemplates((current) => current.filter((item) => item.id !== selected.id));
      onChange({ ...value, templateId: DEFAULT_TEMPLATE_ID });
    } catch (cause) {
      onError(cause);
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="analysis-prompt-selector" aria-label="当前理解提示词">
      <div className="analysis-prompt-heading">
        <div>
          <span>分析方式</span>
          <strong>{selected?.name ?? "均衡解释"}</strong>
        </div>
        {selected && !selected.isBuiltin ? <em>个人模板</em> : <em>内置模板</em>}
      </div>
      <label>
        <span>提示词模板</span>
        <select
          aria-label="提示词模板"
          value={value.templateId}
          disabled={disabled || loading || saving}
          onChange={(event) =>
            onChange({ ...value, templateId: event.currentTarget.value })
          }
        >
          {templates.map((template) => (
            <option key={template.id} value={template.id}>
              {template.isBuiltin ? template.name : `个人 · ${template.name}`}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>本次补充要求</span>
        <textarea
          aria-label="本次补充要求"
          maxLength={4000}
          placeholder="例如：重点解释术语、组件关系和设计权衡。"
          value={value.oneTimeRequirements}
          disabled={disabled || saving}
          onChange={(event) =>
            onChange({ ...value, oneTimeRequirements: event.currentTarget.value })
          }
        />
        <small>{value.oneTimeRequirements.length} / 4000</small>
      </label>
      <div className="analysis-prompt-actions">
        <button
          type="button"
          disabled={disabled || saving || !value.oneTimeRequirements.trim()}
          onClick={() => setShowSave((current) => !current)}
        >
          保存为个人模板
        </button>
        {selected && !selected.isBuiltin ? (
          <button type="button" disabled={disabled || saving} onClick={() => void removePersonal()}>
            删除当前模板
          </button>
        ) : null}
      </div>
      {showSave ? (
        <div className="analysis-prompt-save">
          <input
            aria-label="个人模板名称"
            maxLength={80}
            placeholder="个人模板名称"
            value={templateName}
            disabled={disabled || saving}
            onChange={(event) => setTemplateName(event.currentTarget.value)}
          />
          <button
            className="button quiet"
            type="button"
            disabled={!templateName.trim() || saving}
            onClick={() => void savePersonal()}
          >
            {saving ? "正在保存…" : "确认保存"}
          </button>
        </div>
      ) : null}
    </section>
  );
}
