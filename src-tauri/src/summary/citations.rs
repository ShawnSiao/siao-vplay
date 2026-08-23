use std::collections::HashMap;

use crate::subtitles::SubtitleSegment;

use super::model::{SummaryCitation, SummaryResult, SummarySection};

const MAX_CITATIONS_PER_ITEM: usize = 3;
const MAX_EXCERPT_CHARACTERS: usize = 180;
const MAX_GROUP_GAP_MS: i64 = 5_000;

pub(crate) fn hydrate_result(result: &mut SummaryResult, segments: &[SubtitleSegment]) {
    let by_id = segments
        .iter()
        .map(|segment| (segment.id.as_str(), segment))
        .collect::<HashMap<_, _>>();
    for section in all_sections_mut(result) {
        for evidence in &mut section.evidence {
            evidence.citations = citations_for(&evidence.subtitle_ids, &by_id);
        }
    }
    for entry in &mut result.glossary {
        entry.citations = citations_for(&entry.subtitle_ids, &by_id);
    }
}

fn all_sections_mut(result: &mut SummaryResult) -> Vec<&mut SummarySection> {
    result
        .speaker_narrative
        .iter_mut()
        .chain(&mut result.timeline)
        .chain(&mut result.core_concepts)
        .chain(&mut result.principles_or_architecture)
        .chain(&mut result.examples_and_scenarios)
        .chain(&mut result.design_tradeoffs)
        .chain(&mut result.conclusions)
        .collect()
}

fn citations_for(ids: &[String], by_id: &HashMap<&str, &SubtitleSegment>) -> Vec<SummaryCitation> {
    let mut selected = ids
        .iter()
        .filter_map(|id| by_id.get(id.as_str()).copied())
        .collect::<Vec<_>>();
    selected.sort_by_key(|segment| (segment.ordinal, segment.start_ms));
    selected.dedup_by_key(|segment| segment.id.as_str());
    let mut groups: Vec<Vec<&SubtitleSegment>> = Vec::new();
    for segment in selected {
        let extends_last = groups
            .last()
            .and_then(|group| group.last())
            .is_some_and(|last| {
                segment.ordinal <= last.ordinal + 1
                    && segment.start_ms.saturating_sub(last.end_ms) <= MAX_GROUP_GAP_MS
            });
        if extends_last {
            if let Some(group) = groups.last_mut() {
                group.push(segment);
            }
        } else if groups.len() < MAX_CITATIONS_PER_ITEM {
            groups.push(vec![segment]);
        }
    }
    groups.into_iter().filter_map(build_citation).collect()
}

fn build_citation(group: Vec<&SubtitleSegment>) -> Option<SummaryCitation> {
    let first = group.first()?;
    let last = group.last()?;
    let joined = group
        .iter()
        .map(|segment| segment.text.trim())
        .filter(|text| !text.is_empty())
        .collect::<Vec<_>>()
        .join(" ");
    Some(SummaryCitation {
        start_ms: first.start_ms,
        end_ms: last.end_ms,
        subtitle_count: group.len(),
        excerpt: truncate(&joined),
    })
}

fn truncate(value: &str) -> String {
    let mut text = value
        .chars()
        .take(MAX_EXCERPT_CHARACTERS)
        .collect::<String>();
    if value.chars().count() > MAX_EXCERPT_CHARACTERS {
        text.push('…');
    }
    text
}

#[cfg(test)]
mod tests {
    use super::*;

    fn segment(id: &str, ordinal: usize, start_ms: i64, text: &str) -> SubtitleSegment {
        SubtitleSegment {
            id: id.into(),
            lineage_id: id.into(),
            source_segment_id: None,
            ordinal,
            start_ms,
            end_ms: start_ms + 1_000,
            text: text.into(),
            confidence: None,
            issue_kind: None,
            words: vec![],
        }
    }

    #[test]
    fn converts_internal_ids_to_grouped_readable_citations() {
        let segments = [
            segment("private-a", 0, 10_000, "第一条字幕"),
            segment("private-b", 1, 11_500, "第二条字幕"),
            segment("private-c", 5, 30_000, "第三条字幕"),
        ];
        let by_id = segments
            .iter()
            .map(|item| (item.id.as_str(), item))
            .collect::<HashMap<_, _>>();
        let citations = citations_for(
            &["private-a".into(), "private-b".into(), "private-c".into()],
            &by_id,
        );
        assert_eq!(citations.len(), 2);
        assert_eq!(citations[0].subtitle_count, 2);
        assert_eq!(citations[0].excerpt, "第一条字幕 第二条字幕");
        assert!(!format!("{citations:?}").contains("private-a"));
    }
}
