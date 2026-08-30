use crate::translation::TranslationError;

pub(crate) fn normalize_language_code(value: &str) -> Result<String, TranslationError> {
    let normalized = value.trim().to_ascii_lowercase();
    let valid = (2..=35).contains(&normalized.len())
        && normalized
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || character == '-');
    if !valid {
        return Err(TranslationError::InvalidSelection(format!(
            "语言代码无效：{value}"
        )));
    }
    Ok(normalized)
}
