use std::collections::BTreeSet;

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::subtitles::SubtitleSegment;

mod result;

pub(crate) use result::{
    ResultValidationContext, ValidatedExplanationResult, parse_stored, validate_result,
};

pub(crate) const PROTOCOL_V2: &str = "siaovplay-understanding-v2";
pub(crate) const CONTEXT_WINDOW_MS: i64 = 180_000;
pub(crate) const MAX_CONTEXT_SEGMENTS: usize = 40;
pub(crate) const MAX_KEYFRAMES: usize = 6;
pub(crate) const MAX_RESULT_ITEMS: usize = 12;

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExplanationEntry {
    pub text: String,
    #[serde(default)]
    pub subtitle_segment_ids: Vec<String>,
    #[serde(default)]
    pub frame_ids: Vec<String>,
}

impl ExplanationEntry {
    pub(crate) fn legacy(text: String) -> Self {
        Self {
            text,
            subtitle_segment_ids: Vec::new(),
            frame_ids: Vec::new(),
        }
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(untagged)]
pub(crate) enum ExplanationEntryInput {
    V2(ExplanationEntry),
    V1(String),
}

impl ExplanationEntryInput {
    pub(crate) fn into_entry(self) -> ExplanationEntry {
        match self {
            Self::V2(entry) => entry,
            Self::V1(text) => ExplanationEntry::legacy(text),
        }
    }

    pub(crate) fn is_v2(&self) -> bool {
        matches!(self, Self::V2(_))
    }
}

#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExplanationMaterialSummary {
    pub subtitle_count: usize,
    pub frame_count: usize,
    pub start_ms: i64,
    pub end_ms: i64,
}

pub(crate) fn select_context_segments(
    segments: &[SubtitleSegment],
    playback_cutoff_ms: i64,
) -> Vec<SubtitleSegment> {
    let window_start = playback_cutoff_ms.saturating_sub(CONTEXT_WINDOW_MS);
    let mut eligible = segments
        .iter()
        .filter(|segment| segment.start_ms <= playback_cutoff_ms && segment.end_ms >= window_start)
        .cloned()
        .collect::<Vec<_>>();
    if eligible.is_empty() {
        if let Some(previous) = segments
            .iter()
            .rev()
            .find(|segment| segment.start_ms <= playback_cutoff_ms)
        {
            eligible.push(previous.clone());
        }
    }
    if eligible.len() > MAX_CONTEXT_SEGMENTS {
        eligible = eligible.split_off(eligible.len() - MAX_CONTEXT_SEGMENTS);
    }
    eligible
}

pub(crate) fn keyframe_timestamps(scene_start_ms: i64, playback_cutoff_ms: i64) -> Vec<i64> {
    let latest = playback_cutoff_ms.saturating_sub(250).max(scene_start_ms);
    let span = latest.saturating_sub(scene_start_ms);
    let mut timestamps = BTreeSet::new();
    if span == 0 {
        timestamps.insert(scene_start_ms);
    } else {
        for step in 1..=MAX_KEYFRAMES {
            let timestamp = scene_start_ms
                .saturating_add(span.saturating_mul(step as i64) / MAX_KEYFRAMES as i64);
            timestamps.insert(timestamp.min(playback_cutoff_ms));
        }
    }
    timestamps.into_iter().take(MAX_KEYFRAMES).collect()
}

pub(crate) fn parse_material_scope(
    protocol_version: &str,
    raw: &str,
) -> Result<Vec<String>, serde_json::Error> {
    serde_json::from_str(raw).or_else(|error| {
        (protocol_version == "siaovplay-understanding-v1")
            .then(Vec::new)
            .ok_or(error)
    })
}

pub(crate) fn result_schema(
    task_id: &str,
    source_version_id: &str,
    playback_cutoff_ms: i64,
    authorized_segment_ids: &[String],
    authorized_frame_ids: &[String],
) -> Value {
    let entry = json!({
        "type": "object",
        "additionalProperties": false,
        "required": ["text", "subtitleSegmentIds", "frameIds"],
        "properties": {
            "text": {"type": "string", "minLength": 1, "maxLength": 600},
            "subtitleSegmentIds": {
                "type": "array",
                "uniqueItems": true,
                "items": {"type": "string", "enum": authorized_segment_ids}
            },
            "frameIds": {
                "type": "array",
                "uniqueItems": true,
                "items": {"type": "string", "enum": authorized_frame_ids}
            }
        },
        "anyOf": [
            {"properties": {"subtitleSegmentIds": {"minItems": 1}}},
            {"properties": {"frameIds": {"minItems": 1}}}
        ]
    });
    json!({
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "type": "object",
        "additionalProperties": false,
        "required": [
            "protocolVersion", "taskId", "sourceVersionId", "playbackCutoffMs",
            "confirmedFacts", "possibleInterpretations", "withheldReason"
        ],
        "properties": {
            "protocolVersion": {"type": "string", "const": PROTOCOL_V2},
            "taskId": {"type": "string", "const": task_id},
            "sourceVersionId": {"type": "string", "const": source_version_id},
            "playbackCutoffMs": {"type": "integer", "const": playback_cutoff_ms},
            "confirmedFacts": {
                "type": "array", "minItems": 1, "maxItems": MAX_RESULT_ITEMS,
                "items": entry
            },
            "possibleInterpretations": {
                "type": "array", "minItems": 1, "maxItems": MAX_RESULT_ITEMS,
                "items": entry
            },
            "withheldReason": {"type": ["string", "null"], "maxLength": 300}
        }
    })
}

#[cfg(test)]
pub(crate) fn fixture_result(
    protocol_version: &str,
    task_id: &str,
    source_version_id: &str,
    playback_cutoff_ms: i64,
    subtitle_segment_id: &str,
    frame_id: &str,
) -> Value {
    json!({
        "protocolVersion": protocol_version,
        "taskId": task_id,
        "sourceVersionId": source_version_id,
        "playbackCutoffMs": playback_cutoff_ms,
        "confirmedFacts": [{
            "text": "两个人约定在车站前见面。",
            "subtitleSegmentIds": [subtitle_segment_id], "frameIds": []
        }],
        "possibleInterpretations": [{
            "text": "结合当前语气，这个约定对说话者可能很重要。",
            "subtitleSegmentIds": [subtitle_segment_id], "frameIds": [frame_id]
        }],
        "withheldReason": "不展开播放位置之后的内容。"
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn segment(ordinal: usize, start_ms: i64) -> SubtitleSegment {
        SubtitleSegment {
            id: format!("segment-{ordinal}"),
            lineage_id: format!("lineage-{ordinal}"),
            source_segment_id: None,
            ordinal,
            start_ms,
            end_ms: start_ms + 2_000,
            text: format!("line {ordinal}"),
            confidence: None,
            issue_kind: None,
            words: Vec::new(),
        }
    }

    #[test]
    fn context_is_limited_to_three_minutes_forty_segments_and_the_cutoff() {
        let segments = (0..120)
            .map(|ordinal| segment(ordinal, ordinal as i64 * 3_000))
            .collect::<Vec<_>>();
        let selected = select_context_segments(&segments, 300_000);
        assert_eq!(selected.len(), MAX_CONTEXT_SEGMENTS);
        assert!(selected.iter().all(|item| item.start_ms <= 300_000));
        assert!(selected.iter().all(|item| item.end_ms >= 120_000));
        assert_eq!(selected.first().map(|item| item.ordinal), Some(61));
        assert_eq!(selected.last().map(|item| item.ordinal), Some(100));
    }

    #[test]
    fn keyframes_are_unique_bounded_and_never_future() {
        let timestamps = keyframe_timestamps(120_000, 300_000);
        assert_eq!(timestamps.len(), MAX_KEYFRAMES);
        assert!(timestamps.windows(2).all(|pair| pair[0] < pair[1]));
        assert!(timestamps.iter().all(|timestamp| *timestamp <= 300_000));
    }

    #[test]
    fn legacy_object_material_scope_is_treated_as_unclassified() {
        assert_eq!(
            parse_material_scope("siaovplay-understanding-v1", "{}").unwrap(),
            Vec::<String>::new()
        );
        assert!(parse_material_scope(PROTOCOL_V2, "{}").is_err());
    }
}
