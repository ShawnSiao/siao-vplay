use std::collections::HashSet;

use super::model::{EvidenceKind, SummaryResult};
use crate::store::StoreError;

pub(crate) fn validate_result(
    result: &SummaryResult,
    allowed_subtitle_ids: &HashSet<String>,
    cutoff_ms: Option<i64>,
) -> Result<(), StoreError> {
    if result.title.trim().is_empty() || result.overview.trim().is_empty() {
        return Err(StoreError::Validation("总结标题和概览不能为空".to_owned()));
    }
    if result.timeline.is_empty()
        && result.core_concepts.is_empty()
        && result.principles_or_architecture.is_empty()
        && result.conclusions.is_empty()
    {
        return Err(StoreError::Validation(
            "总结至少需要一个带依据的章节".to_owned(),
        ));
    }
    for section in result
        .timeline
        .iter()
        .chain(&result.core_concepts)
        .chain(&result.principles_or_architecture)
        .chain(&result.conclusions)
    {
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

pub(crate) fn result_schema() -> serde_json::Value {
    serde_json::from_str(include_str!("summary-result.schema.json"))
        .expect("bundled summary result schema must be valid")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::summary::model::{SummaryEvidence, SummarySection};

    #[test]
    fn rejects_out_of_scope_evidence() {
        let result = SummaryResult {
            title: "标题".into(),
            overview: "概览".into(),
            timeline: vec![],
            core_concepts: vec![],
            principles_or_architecture: vec![SummarySection {
                title: "原理".into(),
                body: "正文".into(),
                evidence: vec![SummaryEvidence {
                    kind: EvidenceKind::VideoStatement,
                    claim: "声明".into(),
                    subtitle_ids: vec!["future".into()],
                    frame_timestamps_ms: vec![],
                }],
            }],
            conclusions: vec![],
            limitations: vec![],
            glossary: vec![],
            mermaid: None,
        };
        assert!(validate_result(&result, &HashSet::from(["past".into()]), Some(1_000)).is_err());
    }
}
