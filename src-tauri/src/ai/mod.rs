pub mod commands;
pub mod network;

mod catalog;
mod config;
mod connection;
mod credentials;
mod error;
mod probe;
mod providers;
mod storage;
mod task_orchestrator;
mod task_persistence;
mod task_types;
mod types;

use std::path::Path;

pub use error::AiError;
pub(crate) use types::AiTaskExecutionInfo;

pub fn initialize(data_directory: &Path, legacy_proxy: Option<&str>) -> Result<(), AiError> {
    config::initialize(data_directory)?;
    network::initialize(data_directory, legacy_proxy)
}
