use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum EvidenceKind {
    VideoStatement,
    SubtitleOrFrame,
    AiInference,
    NeedsExternalValidation,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SummaryEvidence {
    pub kind: EvidenceKind,
    pub claim: String,
    #[serde(default)]
    pub subtitle_ids: Vec<String>,
    #[serde(default)]
    pub frame_timestamps_ms: Vec<i64>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub citations: Vec<SummaryCitation>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SummaryCitation {
    pub start_ms: i64,
    pub end_ms: i64,
    pub subtitle_count: usize,
    pub excerpt: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SummarySection {
    pub title: String,
    pub body: String,
    #[serde(default)]
    pub evidence: Vec<SummaryEvidence>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SummaryGlossaryEntry {
    pub term: String,
    pub explanation: String,
    #[serde(default)]
    pub subtitle_ids: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub citations: Vec<SummaryCitation>,
}

fn legacy_summary_format_version() -> u32 {
    1
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SummaryResult {
    #[serde(default = "legacy_summary_format_version")]
    pub format_version: u32,
    pub title: String,
    pub overview: String,
    #[serde(default)]
    pub covered_chunk_ordinals: Vec<usize>,
    #[serde(default)]
    pub speaker_narrative: Vec<SummarySection>,
    #[serde(default)]
    pub timeline: Vec<SummarySection>,
    #[serde(default)]
    pub core_concepts: Vec<SummarySection>,
    #[serde(default)]
    pub principles_or_architecture: Vec<SummarySection>,
    #[serde(default)]
    pub examples_and_scenarios: Vec<SummarySection>,
    #[serde(default)]
    pub design_tradeoffs: Vec<SummarySection>,
    #[serde(default)]
    pub conclusions: Vec<SummarySection>,
    #[serde(default)]
    pub limitations: Vec<String>,
    #[serde(default)]
    pub glossary: Vec<SummaryGlossaryEntry>,
    #[serde(default)]
    pub mermaid: Option<String>,
}
