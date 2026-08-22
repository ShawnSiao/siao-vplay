import { useEffect, useRef, useState } from "react";
import { defaultSubtitleFollowPreferences, isValidSubtitleHighlightColor, subtitleHighlightPresets, type SubtitleFollowPreferences } from "./playbackPreferences";

type Props = { preferences: SubtitleFollowPreferences; onChange: (value: SubtitleFollowPreferences) => void };

function hasLowContrast(color: string) {
  const channels = [1, 3, 5].map((start) => parseInt(color.slice(start, start + 2), 16) / 255);
  const luminance = channels.map((value) => value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
    .reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
  return (luminance + 0.05) / 0.05 < 3;
}

export function SubtitleAppearancePopover({ preferences, onChange }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(preferences.highlightColor.toUpperCase());
  const validDraft = isValidSubtitleHighlightColor(draft);
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => { if (!rootRef.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", close); document.removeEventListener("keydown", escape); };
  }, [open]);
  const changeColor = (color: string) => {
    setDraft(color.toUpperCase());
    onChange({ ...preferences, highlightColor: color.toLowerCase() });
  };
  return <div className="subtitle-settings" ref={rootRef}>
    <button className="subtitle-settings-trigger" type="button" aria-expanded={open} aria-haspopup="dialog" onClick={() => { setDraft(preferences.highlightColor.toUpperCase()); setOpen((value) => !value); }}>字幕设置</button>
    {open ? <section className="subtitle-settings-popover" role="dialog" aria-label="字幕设置">
      <div className="subtitle-settings-heading"><strong>字幕设置</strong><button type="button" aria-label="关闭字幕设置" onClick={() => setOpen(false)}>×</button></div>
      <label className="subtitle-follow-toggle"><input type="checkbox" checked={preferences.enabled} onChange={(event) => onChange({ ...preferences, enabled: event.target.checked })}/><span>原文逐词跟随</span></label>
      <span className="subtitle-settings-label">跟随高亮色</span>
      <div className="subtitle-color-presets" aria-label="高亮色预设">{subtitleHighlightPresets.map((color) => <button key={color} type="button" aria-label={`使用颜色 ${color}`} aria-pressed={preferences.highlightColor === color} style={{ backgroundColor: color }} onClick={() => changeColor(color)}/>)}</div>
      <div className="subtitle-custom-color">
        <input type="color" aria-label="选择高亮色" value={preferences.highlightColor} onChange={(event) => changeColor(event.target.value)}/>
        <input type="text" aria-label="高亮色 HEX 值" value={draft} aria-invalid={!validDraft} onChange={(event) => { const value = event.target.value; setDraft(value); if (isValidSubtitleHighlightColor(value)) changeColor(value); }}/>
      </div>
      {!validDraft ? <small className="subtitle-setting-warning">请输入 6 位 HEX 颜色值。</small> : null}
      {validDraft && hasLowContrast(draft) ? <small className="subtitle-setting-warning">该颜色在深色字幕背景上的辨识度较低。</small> : null}
      <div className="subtitle-settings-actions">
        <button type="button" onClick={() => changeColor(defaultSubtitleFollowPreferences.highlightColor)}>恢复默认颜色</button>
        <button type="button" onClick={() => onChange({ ...preferences, position: { ...defaultSubtitleFollowPreferences.position } })}>恢复默认位置</button>
      </div>
      <small className="subtitle-drag-hint">可直接拖动视频中的字幕框调整位置。</small>
    </section> : null}
  </div>;
}
