import { useEffect, useRef, useState } from "react";
import { SubtitleColorControl } from "./SubtitleColorControl";
import {
  defaultSubtitleFollowPreferences,
  subtitleBaseColorPresets,
  subtitleHighlightPresets,
  type SubtitleDisplayPreferences,
  type SubtitleQuickToolbarMode,
  type SubtitleTextSize,
} from "./playbackPreferences";

type Props = { preferences: SubtitleDisplayPreferences; onChange: (value: SubtitleDisplayPreferences) => void };

function relativeLuminance(color: string) {
  const channels = [1, 3, 5].map((start) => parseInt(color.slice(start, start + 2), 16) / 255);
  return channels.map((value) => value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
    .reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
}

function contrastRatio(first: string, second: string) {
  const values = [relativeLuminance(first), relativeLuminance(second)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

export function SubtitleAppearancePopover({ preferences, onChange }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => { if (!rootRef.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", close); document.removeEventListener("keydown", escape); };
  }, [open]);
  return <div className="subtitle-settings" ref={rootRef}>
    <button className="subtitle-settings-trigger" type="button" aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen((value) => !value)}>字幕设置</button>
    {open ? <section className="subtitle-settings-popover" role="dialog" aria-label="字幕设置">
      <div className="subtitle-settings-heading"><strong>字幕设置</strong><button type="button" aria-label="关闭字幕设置" onClick={() => setOpen(false)}>×</button></div>
      <label className="subtitle-follow-toggle"><input type="checkbox" checked={preferences.enabled} onChange={(event) => onChange({ ...preferences, enabled: event.target.checked })}/><span>原文逐词跟随</span></label>
      <label className="subtitle-display-setting">
        <span>字幕大小</span>
        <select aria-label="字幕大小" value={preferences.textSize} onChange={(event) => onChange({ ...preferences, textSize: event.target.value as SubtitleTextSize })}>
          <option value="small">小号</option><option value="medium">中号</option><option value="large">大号</option>
        </select>
      </label>
      <label className="subtitle-display-setting">
        <span>快捷工具栏</span>
        <select aria-label="字幕快捷工具栏显示" value={preferences.quickToolbar} onChange={(event) => onChange({ ...preferences, quickToolbar: event.target.value as SubtitleQuickToolbarMode })}>
          <option value="auto">自动显示</option><option value="always">始终显示</option><option value="hidden">隐藏</option>
        </select>
      </label>
      <SubtitleColorControl label="字幕默认颜色" value={preferences.baseTextColor} defaultValue={defaultSubtitleFollowPreferences.baseTextColor} presets={subtitleBaseColorPresets} warning={contrastRatio(preferences.baseTextColor, "#111418") < 3 ? "该颜色在深色字幕背景上的辨识度较低。" : null} onChange={(baseTextColor) => onChange({ ...preferences, baseTextColor })}/>
      <SubtitleColorControl label="当前词颜色" value={preferences.highlightColor} defaultValue={defaultSubtitleFollowPreferences.highlightColor} presets={subtitleHighlightPresets} warning={contrastRatio(preferences.highlightColor, preferences.baseTextColor) < 1.5 ? "当前词颜色与字幕默认颜色过于接近。" : null} onChange={(highlightColor) => onChange({ ...preferences, highlightColor })}/>
      <div className="subtitle-settings-actions">
        <button type="button" onClick={() => onChange({ ...preferences, position: { ...defaultSubtitleFollowPreferences.position } })}>恢复默认位置</button>
      </div>
      <small className="subtitle-drag-hint">可直接拖动视频中的字幕框调整位置。</small>
    </section> : null}
  </div>;
}
