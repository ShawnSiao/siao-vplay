use super::{TranscriptionLanguage, TranscriptionModelKind};
use serde::{Deserialize, Serialize, de::DeserializeOwned};

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(test, derive(schemars::JsonSchema))]
pub enum TranscriptionStatus { Queued, Extracting, Transcribing, Validating, Completed, Failed, Cancelled, Interrupted }
impl TranscriptionStatus {
    pub(super) fn as_str(self) -> &'static str {
        match self {
            Self::Queued => "queued", Self::Extracting => "extracting", Self::Transcribing => "transcribing",
            Self::Validating => "validating", Self::Completed => "completed", Self::Failed => "failed",
            Self::Cancelled => "cancelled", Self::Interrupted => "interrupted",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
#[cfg_attr(test, derive(schemars::JsonSchema))]
pub enum TranscriptionBackend { Vulkan, Cpu }
impl TranscriptionBackend {
    pub(super) fn as_str(self) -> &'static str { match self { Self::Vulkan => "vulkan", Self::Cpu => "cpu" } }
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(schemars::JsonSchema))]
pub struct TranscriptionJob {
    pub id: String,
    pub project_id: String,
    pub status: TranscriptionStatus,
    pub stage: String,
    #[cfg_attr(test, schemars(range(min = 0, max = 1)))]
    pub progress: f64,
    pub language_code: TranscriptionLanguage,
    pub model_kind: TranscriptionModelKind,
    pub runtime_backend: TranscriptionBackend,
    pub runtime_version: String,
    pub subtitle_version_id: Option<String>,
    pub error_code: Option<String>,
    pub error_message: Option<String>,
    #[cfg_attr(test, schemars(range(min = -9007199254740991_i64, max = 9007199254740991_i64)))]
    pub created_at_ms: i64,
    #[cfg_attr(test, schemars(range(min = -9007199254740991_i64, max = 9007199254740991_i64)))]
    pub updated_at_ms: i64,
    #[cfg_attr(test, schemars(range(min = -9007199254740991_i64, max = 9007199254740991_i64)))]
    pub started_at_ms: Option<i64>,
    #[cfg_attr(test, schemars(range(min = -9007199254740991_i64, max = 9007199254740991_i64)))]
    pub completed_at_ms: Option<i64>,
}

pub(super) fn read_enum<T: DeserializeOwned>(row: &rusqlite::Row<'_>, index: usize) -> rusqlite::Result<T> {
    let value: String = row.get(index)?;
    serde_json::from_value(serde_json::Value::String(value)).map_err(|error|
        rusqlite::Error::FromSqlConversionFailure(index, rusqlite::types::Type::Text, Box::new(error)))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn check<T: DeserializeOwned>(valid: &str, invalid: &str) {
        let connection = rusqlite::Connection::open_in_memory().unwrap();
        assert!(connection.query_row("SELECT ?1", [valid], |row| read_enum::<T>(row, 0)).is_ok());
        assert!(connection.query_row("SELECT ?1", [invalid], |row| read_enum::<T>(row, 0)).is_err());
    }
    #[test]
    fn rejects_unknown_persisted_job_enum_values() {
        check::<TranscriptionStatus>("completed", "unknown");
        check::<TranscriptionLanguage>("ja", "zh");
        check::<TranscriptionModelKind>("base", "large");
        check::<TranscriptionBackend>("vulkan", "cuda");
    }
}
