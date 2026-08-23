use std::collections::BTreeSet;

use serde::Deserialize;

use super::{ExplanationEntry, ExplanationEntryInput, MAX_RESULT_ITEMS, PROTOCOL_V2};

#[derive(Clone, Debug)]
pub(crate) struct ResultValidationContext<'a> {
    pub protocol_version: &'a str,
    pub task_id: &'a str,
    pub source_version_id: &'a str,
    pub playback_cutoff_ms: i64,
    pub authorized_segment_ids: &'a [String],
    pub authorized_frame_ids: &'a [String],
}

#[derive(Clone, Debug)]
pub(crate) struct ValidatedExplanationResult {
    pub confirmed_facts: Vec<ExplanationEntry>,
    pub possible_interpretations: Vec<ExplanationEntry>,
    pub withheld_reason: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct RawExplanationResult {
    protocol_version: String,
    task_id: String,
    source_version_id: String,
    playback_cutoff_ms: i64,
    confirmed_facts: Vec<ExplanationEntryInput>,
    possible_interpretations: Vec<ExplanationEntryInput>,
    withheld_reason: Option<String>,
}

pub(crate) fn validate_result(
    context: &ResultValidationContext<'_>,
    raw: &str,
) -> Result<ValidatedExplanationResult, String> {
    let result = serde_json::from_str::<RawExplanationResult>(raw.trim_start_matches('\u{feff}'))
        .map_err(|error| format!("结果 JSON 无效：{error}"))?;
    if result.protocol_version != context.protocol_version
        || result.task_id != context.task_id
        || result.source_version_id != context.source_version_id
        || result.playback_cutoff_ms != context.playback_cutoff_ms
    {
        return Err("结果与任务、字幕版本或播放截止时间不一致".to_owned());
    }
    let maximum = if context.protocol_version == PROTOCOL_V2 {
        MAX_RESULT_ITEMS
    } else {
        8
    };
    let confirmed_facts = validate_items(context, "确认事实", result.confirmed_facts, maximum)?;
    let possible_interpretations = validate_items(
        context,
        "可能解读",
        result.possible_interpretations,
        maximum,
    )?;
    let withheld_reason = result
        .withheld_reason
        .map(|value| validate_text("未展开说明", value, 300))
        .transpose()?
        .filter(|value| !value.is_empty());
    Ok(ValidatedExplanationResult {
        confirmed_facts,
        possible_interpretations,
        withheld_reason,
    })
}

fn validate_items(
    context: &ResultValidationContext<'_>,
    label: &str,
    items: Vec<ExplanationEntryInput>,
    maximum: usize,
) -> Result<Vec<ExplanationEntry>, String> {
    if !(1..=maximum).contains(&items.len()) {
        return Err(format!("{label}必须包含 1 到 {maximum} 项"));
    }
    let authorized_segments = context
        .authorized_segment_ids
        .iter()
        .cloned()
        .collect::<BTreeSet<_>>();
    let authorized_frames = context
        .authorized_frame_ids
        .iter()
        .cloned()
        .collect::<BTreeSet<_>>();
    let requires_evidence = context.protocol_version == PROTOCOL_V2;
    let mut seen = BTreeSet::new();
    items
        .into_iter()
        .map(|input| {
            if requires_evidence && !input.is_v2() {
                return Err(format!("{label}必须包含字幕段或关键帧依据"));
            }
            let mut item = input.into_entry();
            item.text = validate_text(label, item.text, 600)?;
            if !seen.insert(item.text.clone()) {
                return Err(format!("{label}包含重复内容"));
            }
            validate_ids(
                label,
                &mut item.subtitle_segment_ids,
                &authorized_segments,
                "字幕段",
            )?;
            validate_ids(label, &mut item.frame_ids, &authorized_frames, "关键帧")?;
            if requires_evidence
                && item.subtitle_segment_ids.is_empty()
                && item.frame_ids.is_empty()
            {
                return Err(format!("{label}至少需要一个有效字幕段或关键帧依据"));
            }
            Ok(item)
        })
        .collect()
}

fn validate_ids(
    label: &str,
    ids: &mut [String],
    authorized: &BTreeSet<String>,
    evidence_label: &str,
) -> Result<(), String> {
    let mut seen = BTreeSet::new();
    for id in ids {
        *id = id.trim().to_owned();
        if id.is_empty() || !authorized.contains(id) {
            return Err(format!("{label}引用了未授权的{evidence_label} ID"));
        }
        if !seen.insert(id.clone()) {
            return Err(format!("{label}包含重复的{evidence_label} ID"));
        }
    }
    Ok(())
}

fn validate_text(label: &str, value: String, maximum_characters: usize) -> Result<String, String> {
    let value = value.trim().to_owned();
    if value.is_empty() {
        return Err(format!("{label}不能为空"));
    }
    if value.chars().count() > maximum_characters {
        return Err(format!("{label}超过 {maximum_characters} 个字符"));
    }
    if value
        .chars()
        .any(|character| character.is_control() && !matches!(character, '\n' | '\r' | '\t'))
    {
        return Err(format!("{label}包含不可见控制字符"));
    }
    Ok(value)
}

pub(crate) fn parse_stored(raw: &str) -> Result<Vec<ExplanationEntry>, serde_json::Error> {
    if let Ok(entries) = serde_json::from_str::<Vec<ExplanationEntry>>(raw) {
        return Ok(entries);
    }
    serde_json::from_str::<Vec<String>>(raw)
        .map(|items| items.into_iter().map(ExplanationEntry::legacy).collect())
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn v2_requires_authorized_evidence_for_every_item() {
        let segments = vec!["segment-1".to_owned()];
        let frames = vec!["frame-1".to_owned()];
        let context = ResultValidationContext {
            protocol_version: PROTOCOL_V2,
            task_id: "task-1",
            source_version_id: "source-1",
            playback_cutoff_ms: 42_000,
            authorized_segment_ids: &segments,
            authorized_frame_ids: &frames,
        };
        let invalid = json!({
            "protocolVersion": PROTOCOL_V2,
            "taskId": "task-1",
            "sourceVersionId": "source-1",
            "playbackCutoffMs": 42_000,
            "confirmedFacts": [{
                "text": "直接事实", "subtitleSegmentIds": ["future-segment"], "frameIds": []
            }],
            "possibleInterpretations": [{
                "text": "谨慎解读", "subtitleSegmentIds": [], "frameIds": ["frame-1"]
            }],
            "withheldReason": null
        });
        let error = validate_result(&context, &invalid.to_string()).unwrap_err();
        assert!(error.contains("未授权"));
    }

    #[test]
    fn legacy_strings_are_read_as_entries_without_evidence() {
        let entries = parse_stored(r#"["人物正在等待"]"#).unwrap();
        assert_eq!(entries[0].text, "人物正在等待");
        assert!(entries[0].subtitle_segment_ids.is_empty());
        assert!(entries[0].frame_ids.is_empty());
    }
}
