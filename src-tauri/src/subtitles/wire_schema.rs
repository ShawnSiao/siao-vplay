// Serialized string fields retain the domain storage model; these enums define their wire vocabulary.
#[derive(schemars::JsonSchema)]
#[schemars(rename_all = "snake_case")]
#[expect(dead_code, reason = "Schema-only vocabulary for persisted string fields")]
pub(super) enum SubtitleSource { ImportedFile, Embedded, Transcription, AgentTranslation }
#[derive(schemars::JsonSchema)]
#[schemars(rename_all = "snake_case")]
#[expect(dead_code, reason = "Schema-only vocabulary for persisted string fields")]
pub(super) enum SubtitleCorrection { Missing, Duplicate, Incorrect }
