use crate::subtitles::SubtitleSegment;

const MAX_SEGMENTS: usize = 80;
const MAX_CHARACTERS: usize = 12_000;
const MAX_DURATION_MS: i64 = 8 * 60 * 1_000;

#[derive(Clone, Debug, Eq, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PlannedChunk {
    pub ordinal: usize,
    pub start_ms: i64,
    pub end_ms: i64,
    pub segment_ids: Vec<String>,
    pub context_segment_ids: Vec<String>,
}

pub(crate) fn plan_chunks(segments: &[SubtitleSegment]) -> Vec<PlannedChunk> {
    let mut chunks = Vec::new();
    let mut cursor = 0;
    while cursor < segments.len() {
        let start = cursor;
        let mut characters = 0;
        while cursor < segments.len() {
            let segment = &segments[cursor];
            let next_count = cursor - start + 1;
            let next_characters = characters + segment.text.chars().count();
            let next_duration = segment.end_ms - segments[start].start_ms;
            if cursor > start
                && (next_count > MAX_SEGMENTS
                    || next_characters > MAX_CHARACTERS
                    || next_duration > MAX_DURATION_MS)
            {
                break;
            }
            characters = next_characters;
            cursor += 1;
        }
        let body = &segments[start..cursor];
        chunks.push(PlannedChunk {
            ordinal: chunks.len(),
            start_ms: body[0].start_ms,
            end_ms: body.last().expect("non-empty chunk").end_ms,
            segment_ids: body.iter().map(|segment| segment.id.clone()).collect(),
            context_segment_ids: segments[start.saturating_sub(2)..start]
                .iter()
                .map(|segment| segment.id.clone())
                .collect(),
        });
    }
    chunks
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::subtitles::SubtitleSegment;

    fn segment(index: usize, start_ms: i64, end_ms: i64, chars: usize) -> SubtitleSegment {
        SubtitleSegment {
            id: format!("s-{index}"),
            lineage_id: format!("l-{index}"),
            source_segment_id: None,
            ordinal: index,
            start_ms,
            end_ms,
            text: "字".repeat(chars),
            confidence: None,
            issue_kind: None,
            words: Vec::new(),
        }
    }

    #[test]
    fn stops_at_the_first_limit_and_carries_two_context_segments() {
        let segments = (0..82)
            .map(|index| segment(index, index as i64 * 1_000, index as i64 * 1_000 + 900, 10))
            .collect::<Vec<_>>();
        let chunks = plan_chunks(&segments);
        assert_eq!(chunks[0].segment_ids.len(), 80);
        assert_eq!(chunks[1].segment_ids.len(), 2);
        assert_eq!(chunks[1].context_segment_ids, vec!["s-78", "s-79"]);
    }

    #[test]
    fn never_splits_a_single_long_subtitle() {
        let chunks = plan_chunks(&[segment(0, 0, 1_000, 12_001), segment(1, 2_000, 3_000, 1)]);
        assert_eq!(chunks[0].segment_ids, vec!["s-0"]);
        assert_eq!(chunks[1].segment_ids, vec!["s-1"]);
    }

    #[test]
    fn duration_limit_uses_the_chunk_start() {
        let chunks = plan_chunks(&[
            segment(0, 0, 100, 1),
            segment(1, MAX_DURATION_MS + 1, MAX_DURATION_MS + 100, 1),
        ]);
        assert_eq!(chunks.len(), 2);
    }
}
