use std::collections::HashSet;

use super::model::{AnalysisMode, EvidenceKind, SummaryResult, SummarySection};
use crate::store::StoreError;

pub(crate) fn validate_chunk_result(
    result: &SummaryResult,
    allowed_subtitle_ids: &HashSet<String>,
    allowed_frame_timestamps: &HashSet<i64>,
    cutoff_ms: Option<i64>,
    chunk_ordinal: usize,
) -> Result<(), StoreError> {
    validate_common(result, allowed_subtitle_ids, allowed_frame_timestamps, cutoff_ms)?;
    if result.format_version != 2 || result.covered_chunk_ordinals != vec![chunk_ordinal + 1] {
        return Err(StoreError::Validation(
            "分块总结必须声明当前分块覆盖标记".to_owned(),
        ));
    }
    if result.speaker_narrative.is_empty() && result.timeline.is_empty() {
        return Err(StoreError::Validation(
            "分块总结缺少讲述内容或时间脉络".to_owned(),
        ));
    }
    let minimum = if allowed_subtitle_ids.len() > 1 {
        120
    } else {
        20
    };
    if body_characters(result) < minimum {
        return Err(StoreError::Validation(
            "分块总结过短，无法支持最终详细解读".to_owned(),
        ));
    }
    Ok(())
}

pub(crate) fn validate_final_result(
    result: &SummaryResult,
    allowed_subtitle_ids: &HashSet<String>,
    allowed_frame_timestamps: &HashSet<i64>,
    cutoff_ms: Option<i64>,
    required_chunk_ids: &[HashSet<String>],
    require_examples: bool,
    analysis_mode: AnalysisMode,
) -> Result<(), StoreError> {
    validate_common(result, allowed_subtitle_ids, allowed_frame_timestamps, cutoff_ms)?;
    if result.format_version != 2 {
        return Err(StoreError::Validation("最终总结格式版本无效".to_owned()));
    }
    let expected = (1..=required_chunk_ids.len()).collect::<Vec<_>>();
    if result.covered_chunk_ordinals != expected {
        return Err(StoreError::Validation(
            "最终总结没有覆盖全部已验证分块".to_owned(),
        ));
    }
    if result.speaker_narrative.is_empty() || result.core_concepts.is_empty() {
        return Err(StoreError::Validation(
            "最终总结必须包含讲述脉络和核心概念".to_owned(),
        ));
    }
    if require_examples && result.examples_and_scenarios.is_empty() {
        return Err(StoreError::Validation(
            "源分块包含例子或场景，但最终总结没有保留".to_owned(),
        ));
    }
    if matches!(
        analysis_mode,
        AnalysisMode::ScienceTechnology | AnalysisMode::SoftwareArchitecture
    ) && (result.principles_or_architecture.is_empty() || result.design_tradeoffs.is_empty())
    {
        return Err(StoreError::Validation(
            "技术总结必须包含原理或架构以及设计权衡".to_owned(),
        ));
    }
    validate_chunk_evidence_coverage(result, required_chunk_ids)?;
    let overview_minimum = if required_chunk_ids.len() > 1 {
        120
    } else {
        40
    };
    let body_minimum = if required_chunk_ids.len() > 1 {
        800
    } else {
        160
    };
    if visible_characters(&result.overview) < overview_minimum
        || body_characters(result) < body_minimum
    {
        return Err(StoreError::Validation(
            "最终总结过短，未达到详细解读要求".to_owned(),
        ));
    }
    Ok(())
}

fn validate_chunk_evidence_coverage(
    result: &SummaryResult,
    required_chunk_ids: &[HashSet<String>],
) -> Result<(), StoreError> {
    let cited = all_sections(result)
        .into_iter()
        .flat_map(|section| &section.evidence)
        .flat_map(|evidence| &evidence.subtitle_ids)
        .chain(result.glossary.iter().flat_map(|entry| &entry.subtitle_ids))
        .cloned()
        .collect::<HashSet<_>>();
    if required_chunk_ids
        .iter()
        .any(|chunk| !chunk.is_empty() && chunk.is_disjoint(&cited))
    {
        return Err(StoreError::Validation(
            "最终总结的证据没有覆盖全部字幕分块".to_owned(),
        ));
    }
    Ok(())
}

fn validate_common(
    result: &SummaryResult,
    allowed_subtitle_ids: &HashSet<String>,
    allowed_frame_timestamps: &HashSet<i64>,
    cutoff_ms: Option<i64>,
) -> Result<(), StoreError> {
    if result.title.trim().is_empty() || result.overview.trim().is_empty() {
        return Err(StoreError::Validation("总结标题和概览不能为空".to_owned()));
    }
    if all_sections(result).is_empty() {
        return Err(StoreError::Validation(
            "总结至少需要一个带依据的章节".to_owned(),
        ));
    }
    for section in all_sections(result) {
        if section.title.trim().is_empty() || section.body.trim().is_empty() {
            return Err(StoreError::Validation(
                "总结章节标题和正文不能为空".to_owned(),
            ));
        }
        if section.evidence.is_empty() {
            return Err(StoreError::Validation(
                "总结章节必须包含证据、AI 推导或待验证项".to_owned(),
            ));
        }
        for evidence in &section.evidence {
            if evidence.claim.trim().is_empty() {
                return Err(StoreError::Validation("总结论据不能为空".to_owned()));
            }
            if evidence
                .subtitle_ids
                .iter()
                .any(|id| !allowed_subtitle_ids.contains(id))
            {
                return Err(StoreError::Validation(
                    "总结引用了任务范围外的字幕".to_owned(),
                ));
            }
            if evidence.frame_timestamps_ms.iter().any(|timestamp| {
                *timestamp < 0 || !allowed_frame_timestamps.contains(timestamp)
            }) {
                return Err(StoreError::Validation("总结引用了未提供的画面".to_owned()));
            }
            if cutoff_ms.is_some_and(|cutoff| {
                evidence
                    .frame_timestamps_ms
                    .iter()
                    .any(|timestamp| *timestamp > cutoff)
            }) {
                return Err(StoreError::Validation(
                    "总结引用了播放截止点之后的画面".to_owned(),
                ));
            }
            if matches!(
                evidence.kind,
                EvidenceKind::VideoStatement | EvidenceKind::SubtitleOrFrame
            ) && evidence.subtitle_ids.is_empty()
                && evidence.frame_timestamps_ms.is_empty()
            {
                return Err(StoreError::Validation(
                    "视频陈述或证据必须引用字幕或画面".to_owned(),
                ));
            }
        }
    }
    for entry in &result.glossary {
        if entry
            .subtitle_ids
            .iter()
            .any(|id| !allowed_subtitle_ids.contains(id))
        {
            return Err(StoreError::Validation(
                "术语表引用了任务范围外的字幕".to_owned(),
            ));
        }
    }
    Ok(())
}

fn all_sections(result: &SummaryResult) -> Vec<&SummarySection> {
    result
        .speaker_narrative
        .iter()
        .chain(&result.timeline)
        .chain(&result.core_concepts)
        .chain(&result.principles_or_architecture)
        .chain(&result.examples_and_scenarios)
        .chain(&result.design_tradeoffs)
        .chain(&result.conclusions)
        .collect()
}

fn body_characters(result: &SummaryResult) -> usize {
    all_sections(result)
        .into_iter()
        .map(|section| visible_characters(&section.body))
        .sum()
}

fn visible_characters(value: &str) -> usize {
    value
        .chars()
        .filter(|character| !character.is_whitespace())
        .count()
}

pub(crate) fn result_schema() -> serde_json::Value {
    serde_json::from_str(include_str!("summary-result.schema.json"))
        .expect("bundled summary result schema must be valid")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::summary::model::{SummaryCitation, SummaryEvidence};

    fn evidence(id: &str) -> SummaryEvidence {
        SummaryEvidence {
            kind: EvidenceKind::VideoStatement,
            claim: "讲者明确说明了处理步骤".into(),
            subtitle_ids: vec![id.into()],
            frame_timestamps_ms: vec![],
            citations: Vec::<SummaryCitation>::new(),
        }
    }

    fn section(id: &str) -> SummarySection {
        SummarySection {
            title: "机制".into(),
            body: "这一部分详细解释输入如何经过分析、处理和验证后传递到下游，并说明各步骤之间的依赖关系与适用边界。".repeat(3),
            evidence: vec![evidence(id)],
        }
    }

    fn detailed_result(id: &str) -> SummaryResult {
        SummaryResult {
            format_version: 2,
            title: "详细解读".into(),
            overview: "讲者从问题背景开始，依次解释机制、组件关系、实际例子与适用边界，最后指出需要独立验证的结论。".repeat(4),
            covered_chunk_ordinals: vec![1],
            speaker_narrative: vec![section(id)],
            timeline: vec![],
            core_concepts: vec![section(id)],
            principles_or_architecture: vec![section(id)],
            examples_and_scenarios: vec![section(id)],
            design_tradeoffs: vec![section(id)],
            conclusions: vec![],
            limitations: vec![],
            glossary: vec![],
            mermaid: None,
        }
    }

    #[test]
    fn rejects_unprovided_frames_even_when_before_the_playback_cutoff() {
        let ids = HashSet::from(["past".into()]);
        let allowed = HashSet::from([500]);
        for timestamp in [-1, 400, 600] {
            let mut result = detailed_result("past");
            result.speaker_narrative[0].evidence[0].frame_timestamps_ms = vec![timestamp];
            assert!(validate_chunk_result(&result, &ids, &allowed, Some(1000), 0).is_err(), "accepted unprovided frame {timestamp}");
            assert!(validate_final_result(&result, &ids, &allowed, Some(1000), &[ids.clone()], true, AnalysisMode::ScienceTechnology).is_err());
        }
        let mut result = detailed_result("past");
        result.speaker_narrative[0].evidence[0].frame_timestamps_ms = vec![500];
        assert!(validate_chunk_result(&result, &ids, &allowed, Some(1000), 0).is_ok());
        assert!(validate_final_result(&result, &ids, &allowed, Some(1000), &[ids.clone()], true, AnalysisMode::ScienceTechnology).is_ok());
        assert!(validate_chunk_result(&result, &ids, &HashSet::new(), Some(1000), 0).is_err());
    }

    #[test]
    fn rejects_out_of_scope_evidence() {
        assert!(
            validate_final_result(
                &detailed_result("future"),
                &HashSet::from(["past".into()]),
                &HashSet::new(),
                Some(1_000),
                &[HashSet::from(["past".into()])],
                true,
                AnalysisMode::ScienceTechnology,
            )
            .is_err()
        );
    }

    #[test]
    fn rejects_shallow_final_result() {
        let mut result = detailed_result("past");
        result.overview = "一句话".into();
        assert!(
            validate_final_result(
                &result,
                &HashSet::from(["past".into()]),
                &HashSet::new(),
                None,
                &[HashSet::from(["past".into()])],
                true,
                AnalysisMode::ScienceTechnology,
            )
            .is_err()
        );
    }

    #[test]
    fn rejects_a_final_result_that_skips_a_chunk() {
        let mut result = detailed_result("first");
        result.covered_chunk_ordinals = vec![1, 2];
        assert!(
            validate_final_result(
                &result,
                &HashSet::from(["first".into(), "second".into()]),
                &HashSet::new(),
                None,
                &[
                    HashSet::from(["first".into()]),
                    HashSet::from(["second".into()]),
                ],
                true,
                AnalysisMode::ScienceTechnology,
            )
            .is_err()
        );
    }

    #[test]
    fn codex_output_schema_avoids_unsupported_unique_items() {
        let schema = result_schema();
        assert!(
            schema
                .pointer("/properties/coveredChunkOrdinals/uniqueItems")
                .is_none()
        );
        assert_eq!(
            schema.pointer("/properties/formatVersion/type"),
            Some(&serde_json::json!("integer"))
        );
        assert_eq!(
            schema.pointer("/$defs/sections/items/properties/evidence/items/properties/kind/type"),
            Some(&serde_json::json!("string"))
        );
    }
}
