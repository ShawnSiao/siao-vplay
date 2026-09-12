// Schema vocabularies for serialized storage strings; no database representation change.
#[derive(schemars::JsonSchema)]
#[schemars(rename_all = "snake_case")]
#[expect(dead_code, reason = "Schema-only vocabulary")]
pub(super) enum TaskType { SubtitleTranslation }
#[derive(schemars::JsonSchema)]
#[schemars(rename_all = "snake_case")]
#[expect(dead_code, reason = "Schema-only vocabulary")]
pub(super) enum Handoff { Manual, Codex, Api }
#[derive(schemars::JsonSchema)]
#[schemars(rename_all = "snake_case")]
#[expect(dead_code, reason = "Schema-only vocabulary")]
pub(super) enum TaskStatus { AwaitingExternalResult, Queued, Running, Validating, Completed, Failed, Cancelled, Interrupted }
#[derive(schemars::JsonSchema)]
#[schemars(rename_all = "snake_case")]
#[expect(dead_code, reason = "Schema-only vocabulary")]
pub(super) enum ValidationStatus { Accepted, AcceptedWithWarnings }
