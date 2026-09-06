use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    path::{Path, PathBuf},
    process::{Command, Stdio},
};

use serde::Serialize;
use sha2::{Digest, Sha256};

use super::{
    markdown_report,
    model::{ExportVideoSummaryInput, SummaryExport},
    result_repository::SummaryResultRepository,
    task_repository::{SummaryTaskRepository, now_ms},
};
use crate::{
    media,
    store::{ProjectStore, StoreError},
};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ExportManifest {
    protocol_version: &'static str,
    report: String,
    report_sha256: String,
    assets: BTreeMap<String, String>,
    visual_material_used_by_ai: bool,
}

pub(crate) fn export(
    store: &ProjectStore,
    input: ExportVideoSummaryInput,
) -> Result<SummaryExport, StoreError> {
    let destination = PathBuf::from(input.directory.trim());
    if !destination.is_dir() {
        return Err(StoreError::Validation(
            "请选择已存在的报告保存目录".to_owned(),
        ));
    }
    let summary = SummaryResultRepository::new(store).get_summary(&input.summary_id)?;
    let task = SummaryTaskRepository::new(store).get(&summary.task_id)?;
    let project = store.get_project(&summary.project_id)?;
    let final_directory = unique_directory(&destination, &project.title, now_ms()?);
    let temporary = destination.join(format!(".siaovplay-summary-{}.tmp", summary.id));
    if temporary.exists() {
        return Err(StoreError::Validation("总结报告临时目录已存在".to_owned()));
    }
    fs::create_dir(&temporary)?;
    let result = (|| {
        let assets_directory = temporary.join("assets");
        fs::create_dir(&assets_directory)?;
        let timestamps =
            representative_timestamps(&summary.result, &task, summary.playback_cutoff_ms);
        let assets = extract_frames(
            &project.media_source.locator,
            &assets_directory,
            &timestamps,
        )?;
        let report = markdown_report::render(&project.title, &summary, &task, &assets);
        fs::write(temporary.join("report.md"), report.as_bytes())?;
        let report_sha256 = digest(report.as_bytes());
        let manifest = ExportManifest {
            protocol_version: "siaovplay-summary-export-v1",
            report: "report.md".to_owned(),
            report_sha256: report_sha256.clone(),
            assets: assets
                .iter()
                .map(|(path, hash)| (format!("assets/{path}"), hash.clone()))
                .collect(),
            visual_material_used_by_ai: summary.visual_material_used,
        };
        fs::write(
            temporary.join("manifest.json"),
            serde_json::to_vec_pretty(&manifest)
                .map_err(|error| StoreError::Validation(error.to_string()))?,
        )?;
        verify_export(&temporary, &manifest)?;
        fs::rename(&temporary, &final_directory)?;
        Ok(SummaryExport {
            directory: final_directory.to_string_lossy().into_owned(),
            report_path: final_directory
                .join("report.md")
                .to_string_lossy()
                .into_owned(),
            manifest_path: final_directory
                .join("manifest.json")
                .to_string_lossy()
                .into_owned(),
            asset_count: assets.len(),
            report_sha256,
        })
    })();
    if result.is_err() && temporary.exists() {
        let _ = fs::remove_dir_all(&temporary);
    }
    result
}

fn representative_timestamps(
    result: &super::model::SummaryResult,
    task: &super::model::SummaryTask,
    cutoff_ms: Option<i64>,
) -> Vec<i64> {
    let selected = result
        .speaker_narrative
        .iter()
        .chain(&result.timeline)
        .chain(&result.core_concepts)
        .chain(&result.principles_or_architecture)
        .chain(&result.examples_and_scenarios)
        .chain(&result.design_tradeoffs)
        .chain(&result.conclusions)
        .flat_map(|section| &section.evidence)
        .flat_map(|evidence| evidence.frame_timestamps_ms.iter().copied())
        .filter(|timestamp| *timestamp >= 0 && cutoff_ms.is_none_or(|cutoff| *timestamp <= cutoff))
        .collect::<BTreeSet<_>>()
        .into_iter()
        .take(12)
        .collect::<Vec<_>>();
    if !selected.is_empty() {
        return selected;
    }
    task.chunks
        .iter()
        .map(|chunk| chunk.start_ms + (chunk.end_ms - chunk.start_ms) / 2)
        .filter(|timestamp| cutoff_ms.is_none_or(|cutoff| *timestamp <= cutoff))
        .take(12)
        .collect()
}

fn extract_frames(
    media_path: &str,
    assets_directory: &Path,
    timestamps: &[i64],
) -> Result<BTreeMap<String, String>, StoreError> {
    if timestamps.is_empty() {
        return Ok(BTreeMap::new());
    }
    let _lease = crate::resource_leases::configured(&["ffmpeg"])?;
    let ffmpeg = media::ffmpeg_path().map_err(|error| StoreError::Validation(error.to_string()))?;
    let mut assets = BTreeMap::new();
    for (index, timestamp) in timestamps.iter().enumerate() {
        let name = format!("frame-{:03}.jpg", index + 1);
        let output = assets_directory.join(&name);
        let status = hidden_command(&ffmpeg)
            .args([
                "-hide_banner",
                "-loglevel",
                "error",
                "-ss",
                &format!("{:.3}", *timestamp as f64 / 1_000.0),
                "-i",
                media_path,
                "-frames:v",
                "1",
                "-q:v",
                "2",
                "-y",
            ])
            .arg(&output)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()?;
        if !status.success() || !output.is_file() {
            return Err(StoreError::Validation(format!(
                "无法提取报告关键帧：{timestamp} ms"
            )));
        }
        assets.insert(name, digest(&fs::read(output)?));
    }
    Ok(assets)
}

fn verify_export(directory: &Path, manifest: &ExportManifest) -> Result<(), StoreError> {
    if digest(&fs::read(directory.join(&manifest.report))?) != manifest.report_sha256 {
        return Err(StoreError::Validation("报告哈希校验失败".to_owned()));
    }
    for (relative, expected) in &manifest.assets {
        let path = Path::new(relative);
        if path.is_absolute()
            || path
                .components()
                .any(|part| matches!(part, std::path::Component::ParentDir))
            || digest(&fs::read(directory.join(path))?) != *expected
        {
            return Err(StoreError::Validation("报告素材校验失败".to_owned()));
        }
    }
    Ok(())
}

fn unique_directory(parent: &Path, title: &str, timestamp: i64) -> PathBuf {
    let clean = title
        .chars()
        .map(|character| {
            if "<>:\"/\\|?*".contains(character) {
                '_'
            } else {
                character
            }
        })
        .collect::<String>();
    let base = format!("{}-分析-{}", clean.trim().trim_end_matches('.'), timestamp);
    (0..)
        .map(|index| {
            parent.join(if index == 0 {
                base.clone()
            } else {
                format!("{base}-{index}")
            })
        })
        .find(|path| !path.exists())
        .expect("an unused report path must exist")
}

fn digest(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn hidden_command(program: &Path) -> Command {
    let mut command = Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000);
    }
    command
}
