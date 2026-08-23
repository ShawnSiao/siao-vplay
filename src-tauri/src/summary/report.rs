use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    path::{Path, PathBuf},
    process::{Command, Stdio},
};

use regex::Regex;
use serde::Serialize;
use sha2::{Digest, Sha256};

use super::{
    model::{ExportVideoSummaryInput, SummaryEvidence, SummaryExport, SummarySection},
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
    let summaries = SummaryResultRepository::new(store);
    let summary = summaries.get_summary(&input.summary_id)?;
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
        let report = render_markdown(&project.title, &summary, &task, &assets);
        let report_path = temporary.join("report.md");
        fs::write(&report_path, report.as_bytes())?;
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
        .timeline
        .iter()
        .chain(&result.core_concepts)
        .chain(&result.principles_or_architecture)
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

fn render_markdown(
    project_title: &str,
    summary: &super::model::VideoSummary,
    task: &super::model::SummaryTask,
    assets: &BTreeMap<String, String>,
) -> String {
    let mut markdown = format!(
        "# {}\n\n## 分析范围\n\n- 视频：{}\n- 范围：{}\n- 截止点：{}\n- 字幕版本：`{}`\n- 分析模式：`{:?}`\n- 执行方式：`{:?}`\n- 服务与模型：{} / {}\n- 提示词模板：{}\n- AI 实际使用视觉材料：{}\n\n## 概览\n\n{}\n",
        safe(&summary.result.title),
        safe(project_title),
        if summary.scope == super::model::AnalysisScope::FullVideo {
            "完整视频"
        } else {
            "截至当前进度"
        },
        summary
            .playback_cutoff_ms
            .map(format_time)
            .unwrap_or_else(|| "完整视频".to_owned()),
        summary.subtitle_version_id,
        summary.analysis_mode,
        task.execution_kind,
        task.provider_id.as_deref().unwrap_or("本机"),
        task.model_id.as_deref().unwrap_or("未记录"),
        safe(&task.prompt_snapshot.template_name),
        if summary.visual_material_used {
            "是"
        } else {
            "否"
        },
        safe(&summary.result.overview),
    );
    render_sections(&mut markdown, "时间线", &summary.result.timeline);
    render_sections(&mut markdown, "核心概念", &summary.result.core_concepts);
    render_sections(
        &mut markdown,
        "原理或架构",
        &summary.result.principles_or_architecture,
    );
    if let Some(mermaid) = summary
        .result
        .mermaid
        .as_deref()
        .filter(|value| !value.trim().is_empty())
    {
        markdown.push_str(&format!("\n```mermaid\n{}\n```\n", safe(mermaid)));
    }
    render_sections(&mut markdown, "行动结论", &summary.result.conclusions);
    markdown.push_str("\n## 局限与待验证\n\n");
    for limitation in &summary.result.limitations {
        markdown.push_str(&format!("- {}\n", safe(limitation)));
    }
    markdown.push_str("\n## 术语表\n\n");
    for entry in &summary.result.glossary {
        markdown.push_str(&format!(
            "- **{}**：{}（字幕：{}）\n",
            safe(&entry.term),
            safe(&entry.explanation),
            entry.subtitle_ids.join(", ")
        ));
    }
    if !assets.is_empty() {
        markdown.push_str("\n## 代表性画面\n\n");
        for name in assets.keys() {
            markdown.push_str(&format!("![代表性画面](assets/{name})\n\n"));
        }
    }
    markdown.push_str(
        "\n> 说明：视频中的主张不等于外部已验证事实；「AI 推导」与「待外部验证」应单独核验。\n",
    );
    markdown
}

fn render_sections(output: &mut String, heading: &str, sections: &[SummarySection]) {
    output.push_str(&format!("\n## {heading}\n\n"));
    for section in sections {
        output.push_str(&format!(
            "### {}\n\n{}\n",
            safe(&section.title),
            safe(&section.body)
        ));
        for evidence in &section.evidence {
            render_evidence(output, evidence);
        }
    }
}

fn render_evidence(output: &mut String, evidence: &SummaryEvidence) {
    output.push_str(&format!(
        "- [{:?}] {}",
        evidence.kind,
        safe(&evidence.claim)
    ));
    if !evidence.subtitle_ids.is_empty() {
        output.push_str(&format!("（字幕：{}）", evidence.subtitle_ids.join(", ")));
    }
    output.push('\n');
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

fn safe(value: &str) -> String {
    let windows_path = Regex::new(r"(?i)[a-z]:\\[^\s\]\[()<>]+").expect("path pattern");
    let key = Regex::new(r"(?i)(sk|api[_-]?key)[-_:= ]?[a-z0-9]{12,}").expect("key pattern");
    key.replace_all(
        &windows_path.replace_all(value, "[本机路径已隐藏]"),
        "[凭证已隐藏]",
    )
    .into_owned()
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

fn format_time(milliseconds: i64) -> String {
    format!(
        "{:02}:{:02}:{:02}",
        milliseconds / 3_600_000,
        milliseconds / 60_000 % 60,
        milliseconds / 1_000 % 60
    )
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn redacts_paths_and_credentials() {
        let value = safe("见 E:\\private\\video.mp4 key sk-abcdefghijklmnop");
        assert!(!value.contains("private"));
        assert!(!value.contains("abcdefghijklmnop"));
    }
}
