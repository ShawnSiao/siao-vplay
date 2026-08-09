pub mod commands;
pub mod network;

mod catalog;
mod config;
mod credentials;
mod error;
mod storage;
mod types;

use std::path::Path;

pub use error::AiError;

pub fn initialize(data_directory: &Path, legacy_proxy: Option<&str>) -> Result<(), AiError> {
    config::initialize(data_directory)?;
    network::initialize(data_directory, legacy_proxy)
}
