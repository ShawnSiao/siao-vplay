#[derive(schemars::JsonSchema)]
#[schemars(rename_all = "snake_case")]
#[expect(dead_code, reason = "Schema vocabulary for persisted task statuses")]
pub(super) enum TaskStatus { Prepared, AwaitingExternalResult, Queued, Running, Paused, Validating, Completed, Failed, Cancelled, Interrupted }
#[derive(schemars::JsonSchema)]
#[schemars(rename_all = "snake_case")]
#[expect(dead_code, reason = "Schema vocabulary for persisted chunk statuses")]
pub(super) enum ChunkStatus { Prepared, Queued, Running, Completed, Failed, Cancelled }

#[derive(schemars::JsonSchema)]
#[schemars(transparent)]
#[expect(dead_code, reason = "Schema-only numeric bound")]
pub(super) struct Timestamp(#[schemars(range(min = 0, max = 9007199254740991_i64))] i64);
#[derive(schemars::JsonSchema)]
#[schemars(transparent)]
#[expect(dead_code, reason = "Schema-only numeric bound")]
pub(super) struct Ordinal(#[schemars(range(min = 0, max = 9007199254740991_u64))] usize);
#[derive(schemars::JsonSchema)]
#[expect(dead_code, reason = "Schema-only protocol vocabulary")]
pub(super) enum ProtocolVersion {
    #[schemars(rename = "siaovplay-summary-v1")]
    V1,
}
