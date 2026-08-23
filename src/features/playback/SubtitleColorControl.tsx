import { useState } from "react";

import { isValidSubtitleColor } from "./playbackPreferences";

type Props = {
  label: string;
  value: string;
  defaultValue: string;
  presets: readonly string[];
  warning?: string | null;
  onChange: (color: string) => void;
};

export function SubtitleColorControl({
  label,
  value,
  defaultValue,
  presets,
  warning,
  onChange,
}: Props) {
  const [draft, setDraft] = useState(value.toUpperCase());
  const validDraft = isValidSubtitleColor(draft);
  const changeColor = (color: string) => {
    if (!isValidSubtitleColor(color)) return;
    const normalized = color.toLowerCase();
    setDraft(normalized.toUpperCase());
    onChange(normalized);
  };

  return (
    <section className="subtitle-color-setting" aria-label={label}>
      <div className="subtitle-color-setting-heading">
        <strong>{label}</strong>
        <button type="button" onClick={() => changeColor(defaultValue)}>
          恢复默认
        </button>
      </div>
      <div className="subtitle-color-presets" aria-label={`${label}预设`}>
        {presets.map((color) => (
          <button
            key={color}
            type="button"
            aria-label={`使用${label} ${color}`}
            aria-pressed={value === color}
            style={{ backgroundColor: color }}
            onClick={() => changeColor(color)}
          />
        ))}
      </div>
      <div className="subtitle-custom-color">
        <input
          type="color"
          aria-label={`选择${label}`}
          value={value}
          onChange={(event) => changeColor(event.target.value)}
        />
        <input
          type="text"
          aria-label={`${label} HEX 值`}
          value={draft}
          aria-invalid={!validDraft}
          onChange={(event) => {
            const next = event.target.value.toUpperCase();
            setDraft(next);
            if (isValidSubtitleColor(next)) onChange(next.toLowerCase());
          }}
          onBlur={(event) => changeColor(event.currentTarget.value)}
        />
      </div>
      {!validDraft ? (
        <small className="subtitle-setting-warning">请输入 6 位 HEX 颜色值。</small>
      ) : warning ? (
        <small className="subtitle-setting-warning">{warning}</small>
      ) : null}
    </section>
  );
}
