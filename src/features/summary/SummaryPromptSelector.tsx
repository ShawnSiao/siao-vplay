import { useEffect, useMemo, useState } from "react";

import {
  deleteAnalysisPromptTemplate,
  listAnalysisPromptTemplates,
  saveAnalysisPromptTemplate,
} from "../analysis/gateway";
import type { AnalysisPromptTemplate, PromptSelection } from "../analysis/types";

type SummaryPromptSelectorProps = {
  value: PromptSelection;
  disabled: boolean;
  onChange: (value: PromptSelection) => void;
  onError: (cause: unknown) => void;
};

export function SummaryPromptSelector({
  value,
  disabled,
  onChange,
  onError,
}: SummaryPromptSelectorProps) {
  const [templates, setTemplates] = useState<AnalysisPromptTemplate[]>([]);
  const [templateName, setTemplateName] = useState("");
  const [managing, setManaging] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    void listAnalysisPromptTemplates("summary")
      .then((items) => {
        if (active) setTemplates(items);
      })
      .catch(onError);
    return () => {
      active = false;
    };
  }, [onError]);

  const selected = useMemo(
    () => templates.find((template) => template.id === value.templateId) ?? null,
    [templates, value.templateId],
  );

  const savePersonal = async () => {
    if (!selected || !templateName.trim() || !value.oneTimeRequirements.trim()) return;
    setSaving(true);
    try {
      const created = await saveAnalysisPromptTemplate({
        id: null,
        taskType: "summary",
        baseTemplateId: selected.isBuiltin ? selected.id : selected.baseTemplateId,
        name: templateName.trim(),
        customRequirements: value.oneTimeRequirements.trim(),
      });
      setTemplates((current) => [...current, created]);
      onChange({ templateId: created.id, oneTimeRequirements: "" });
      setTemplateName("");
      setManaging(false);
    } catch (cause) {
      onError(cause);
    } finally {
      setSaving(false);
    }
  };

  const removePersonal = async () => {
    if (!selected || selected.isBuiltin) return;
    setSaving(true);
    try {
      await deleteAnalysisPromptTemplate(selected.id);
      setTemplates((current) => current.filter((item) => item.id !== selected.id));
      onChange({ templateId: "builtin:summary:automatic", oneTimeRequirements: "" });
    } catch (cause) {
      onError(cause);
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="summary-prompt-selector" aria-label="视频总结提示词">
      <div className="summary-field-heading">
        <span>提示词模板</span>
        <button type="button" disabled={disabled || saving} onClick={() => setManaging((value) => !value)}>
          管理模板
        </button>
      </div>
      <select
        aria-label="视频总结提示词模板"
        value={value.templateId}
        disabled={disabled || saving || templates.length === 0}
        onChange={(event) => onChange({ ...value, templateId: event.currentTarget.value })}
      >
        {templates.map((template) => (
          <option key={template.id} value={template.id}>
            {template.name}{template.isBuiltin ? "（内置）" : "（个人）"}
          </option>
        ))}
      </select>
      <label>
        <span>单次补充要求 <small>仅本次使用</small></span>
        <textarea
          aria-label="视频总结单次补充要求"
          maxLength={4000}
          placeholder="例如：重点解释组件边界、数据流和设计权衡。"
          value={value.oneTimeRequirements}
          disabled={disabled || saving}
          onChange={(event) => onChange({ ...value, oneTimeRequirements: event.currentTarget.value })}
        />
        <em>{value.oneTimeRequirements.length} / 4000</em>
      </label>
      {managing ? (
        <div className="summary-template-manager">
          <input
            aria-label="视频总结个人模板名称"
            maxLength={80}
            placeholder="个人模板名称"
            value={templateName}
            disabled={disabled || saving}
            onChange={(event) => setTemplateName(event.currentTarget.value)}
          />
          <button
            type="button"
            disabled={disabled || saving || !templateName.trim() || !value.oneTimeRequirements.trim()}
            onClick={() => void savePersonal()}
          >
            保存当前要求
          </button>
          {selected && !selected.isBuiltin ? (
            <button type="button" disabled={disabled || saving} onClick={() => void removePersonal()}>
              删除当前个人模板
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
