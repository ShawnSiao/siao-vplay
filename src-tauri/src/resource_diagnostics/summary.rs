use super::*;

pub(super) fn render(
    diagnostics: LocalResourceDiagnostics,
) -> Result<String, ResourceDiagnosticsError> {
    let mut lines = vec![
        "SiaoVPlay 本地资源诊断摘要".to_owned(),
        format!("生成时间：{}", diagnostics.generated_at_ms),
        format!(
            "目录清单：{}；远程目录：{}；签名策略：{}",
            diagnostics.catalog_source,
            if diagnostics.remote_catalog_enabled {
                "启用"
            } else {
                "未启用"
            },
            diagnostics.remote_signature_policy
        ),
        format!("资源位置状态：{}", diagnostics.root_state),
        format!("字幕识别方式：{}", diagnostics.preferred_profile),
        format!(
            "资源变更与备份检查：{}",
            serde_json::to_string(&diagnostics.maintenance)?
        ),
    ];
    for resource in &diagnostics.resources {
        lines.push(format!(
            "资源 {}：状态 {}；当前版本 {}；目录版本 {}；已安装版本 {}；无法验证的安装记录 {}",
            resource.id,
            resource.state,
            resource.active_version.as_deref().unwrap_or("无"),
            resource.catalog_version,
            if resource.versions_readable {
                resource.versions.len().to_string()
            } else {
                "未知（版本检查未完成）".into()
            },
            if resource.versions_readable {
                resource.unverified_receipt_count.to_string()
            } else {
                "未知".into()
            }
        ));
    }
    for task in diagnostics.tasks {
        if task.error_message.is_some() || task.error_code.is_some() {
            // Never copy free-form task errors: paths, signed URLs and credentials
            // cannot be exhaustively removed by a blacklist of text patterns.
            let resource_id = diagnostics
                .resources
                .iter()
                .find(|resource| resource.id == task.resource_id)
                .map(|resource| resource.id.as_str())
                .unwrap_or("未知资源");
            let state = match task.state.as_str() {
                "queued" | "downloading" | "paused" | "verifying" | "installing" | "completed"
                | "failed" | "cancelled" => task.state.as_str(),
                _ => "未知状态",
            };
            lines.push(format!(
                "任务 {} {}：{}；失败详情未包含在摘要中",
                resource_id,
                state,
                public_error_code(task.error_code.as_deref())
            ));
        }
    }
    Ok(lines.join("\n"))
}

fn public_error_code(code: Option<&str>) -> &str {
    match code {
        Some(
            code @ ("root_unavailable"
            | "local_resource_capability_invalid"
            | "local_resource_invalid"
            | "local_resource_error"
            | "local_resource_filesystem_error"
            | "local_resource_serialization_error"
            | "local_resource_task_not_found"
            | "local_resource_task_state_invalid"
            | "pending_action_invalid"
            | "local_resource_artifact_unavailable"
            | "local_resource_download_timeout"
            | "local_resource_download_connection_failed"
            | "local_resource_download_http_failed"
            | "local_resource_download_failed"
            | "local_resource_integrity_failed"
            | "local_resource_archive_invalid"
            | "local_resource_health_check_failed"
            | "local_resource_space_insufficient"
            | "local_resource_removal_confirmation_required"
            | "local_resource_busy"),
        ) => code,
        _ => "未分类",
    }
}
