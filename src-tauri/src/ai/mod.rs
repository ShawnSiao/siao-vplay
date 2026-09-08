pub mod commands;
pub mod network;
pub(crate) mod request_coordinator;

mod catalog;
mod config;
pub(crate) mod dispatch;
pub(crate) mod connection;
mod credentials;
mod error;
mod material_scope;
mod interactive_policy;
mod probe;
pub(crate) mod providers;
mod storage;
pub(crate) mod summary_provider;
mod task_orchestrator;
mod task_cancellation;
mod task_execution;
mod active_execution;
mod task_persistence;
mod task_types;
pub(crate) mod translation_api;
pub(crate) mod types;

use std::path::Path;

pub use error::AiError;
pub(crate) use types::AiTaskExecutionInfo;

pub fn initialize(data_directory: &Path, legacy_proxy: Option<&str>) -> Result<(), AiError> {
    config::initialize(data_directory)?;
    network::initialize(data_directory, legacy_proxy)
}
