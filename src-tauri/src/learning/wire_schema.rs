#[derive(schemars::JsonSchema)]
#[schemars(rename_all = "snake_case")]
#[expect(dead_code, reason = "Schema vocabulary for persisted selection kind")]
pub(super) enum SelectionKind { Word, Phrase, Sentence }
