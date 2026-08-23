use std::{
    path::{Path, PathBuf},
    sync::atomic::AtomicBool,
    time::Duration,
};

use serde_json::Value;

use crate::{
    codex_runner::{self, CodexRunnerError},
    store::ProjectStore,
};

pub(crate) fn invoke(
    store: &ProjectStore,
    task_id: &str,
    directory: &Path,
    prompt: String,
    schema: &Value,
    image_paths: &[PathBuf],
) -> Result<String, CodexRunnerError> {
    std::fs::create_dir_all(directory)?;
    let runtime = codex_runner::require_ready_codex()?;
    let cancellation = AtomicBool::new(false);
    codex_runner::invoke_codex_raw_with_images(
        store,
        task_id,
        &runtime,
        directory,
        prompt,
        schema,
        Duration::from_secs(900),
        &cancellation,
        image_paths,
    )
    .map(|(result, _)| result)
}
