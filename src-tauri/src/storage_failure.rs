use crate::{media::MediaError, store::StoreError};

const MESSAGE: &str = "存储空间不足，请在存储设置中检查播放缓存和应用数据所在磁盘";

pub(crate) fn store_is_full(error: &StoreError) -> bool {
    match error {
        StoreError::FileSystem(error) => error.kind() == std::io::ErrorKind::StorageFull,
        StoreError::Database(rusqlite::Error::SqliteFailure(error, _)) => {
            error.code == rusqlite::ErrorCode::DiskFull
        }
        _ => false,
    }
}

pub(crate) fn media_is_full(error: &MediaError) -> bool {
    match error {
        MediaError::FileSystem(error) => error.kind() == std::io::ErrorKind::StorageFull,
        MediaError::Store(error) => store_is_full(error),
        MediaError::ProxyFailed(message)
        | MediaError::PosterFailed(message)
        | MediaError::ProbeFailed(message)
        | MediaError::SubtitleExtractionFailed(message) => process_message(message).is_some(),
        _ => false,
    }
}

// FFmpeg reports ENOSPC as an English av_strerror message even on localized Windows.
pub(crate) fn process_message(message: &str) -> Option<&'static str> {
    let lower = message.to_ascii_lowercase();
    (message == MESSAGE
        || lower.contains("no space left on device")
        || lower.contains("there is not enough space on the disk")
        || lower.contains("disk quota exceeded"))
    .then_some(MESSAGE)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn sqlite_full_is_distinct_from_busy_or_permission_denied() {
        let full = StoreError::Database(rusqlite::Error::SqliteFailure(
            rusqlite::ffi::Error::new(rusqlite::ffi::SQLITE_FULL),
            None,
        ));
        assert!(store_is_full(&full));
        assert!(!store_is_full(&StoreError::FileSystem(
            std::io::ErrorKind::PermissionDenied.into()
        )));
        assert!(process_message("permission denied").is_none());
    }
}
