#[derive(schemars::JsonSchema)]
#[schemars(rename_all = "snake_case")]
#[expect(dead_code, reason = "Schema vocabulary for persisted task statuses")]
pub(super) enum TaskStatus { Prepared, AwaitingExternalResult, Queued, Running, Paused, Validating, Completed, Failed, Cancelled, Interrupted }
#[derive(schemars::JsonSchema)]
#[schemars(rename_all = "snake_case")]
#[expect(dead_code, reason = "Schema vocabulary for persisted chunk statuses")]
pub(super) enum ChunkStatus { Prepared, Queued, Running, Completed, Failed, Cancelled }
