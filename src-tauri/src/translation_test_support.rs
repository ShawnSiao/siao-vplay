use crate::translation::PrepareTranslationTaskInput;

pub(crate) fn translation_input(
    project_id: String,
    handoff_kind: &str,
    source_language_code: &str,
) -> PrepareTranslationTaskInput {
    PrepareTranslationTaskInput {
        project_id,
        handoff_kind: handoff_kind.to_owned(),
        source_language_code: source_language_code.to_owned(),
        target_language_code: "zh-cn".to_owned(),
        segment_ids: None,
    }
}
