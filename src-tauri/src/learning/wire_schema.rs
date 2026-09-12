#[derive(schemars::JsonSchema)]
#[schemars(rename_all = "snake_case")]
#[expect(dead_code, reason = "Schema vocabulary for persisted selection kind")]
pub(super) enum SelectionKind { Word, Phrase, Sentence }

#[derive(schemars::JsonSchema)]
#[schemars(rename_all = "snake_case")]
#[expect(dead_code, reason = "Schema vocabulary")]
pub(super) enum Handoff { Manual, Codex, Api }
#[derive(schemars::JsonSchema)]
#[schemars(rename_all = "snake_case")]
#[expect(dead_code, reason = "Schema vocabulary")]
pub(super) enum TaskStatus { AwaitingExternalResult, Queued, Running, Validating, Completed, Failed, Cancelled, Interrupted }
