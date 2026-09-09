use super::*;
use serde_json::Value;

pub(crate) fn ensure_ready_for_data_move(data: &Path) -> Result<(), LocalResourceError> {
    let config = data.join(CONFIG_FILE_NAME);
    if activation::pending(&config)? || removal::pending(&config)? {
        return Err(LocalResourceError::InvalidReceipt(
            "资源变更尚待恢复，请先恢复资源状态再迁移应用数据".into(),
        ));
    }
    if persistence::read_candidate::<LocalResourceConfiguration>(&config, &validate_configuration)?
        .is_none()
        && [
            config.with_extension("json.bak"),
            config.with_extension("json.part"),
        ]
        .iter()
        .any(|path| path.exists())
    {
        return Err(LocalResourceError::InvalidReceipt(
            "资源配置尚待恢复，请重新启动应用后再迁移数据".into(),
        ));
    }
    Ok(())
}

fn relocated(value: &str, source: &Path, destination: &Path) -> Option<PathBuf> {
    let relative = Path::new(value).strip_prefix(source).ok()?;
    Some(if relative.as_os_str().is_empty() {
        destination.to_path_buf()
    } else {
        destination.join(relative)
    })
}

fn is_legacy_resource_root(path: &Path) -> bool {
    path.file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| name.eq_ignore_ascii_case(RESOURCE_DIRECTORY_NAME))
}
// Transform only declared path properties; keep unknown properties and source bytes.
pub(crate) fn relocate_data_config(
    name: &str,
    bytes: &[u8],
    source: &Path,
    destination: &Path,
) -> Result<Option<Vec<u8>>, LocalResourceError> {
    let mut value: Value = serde_json::from_slice(bytes)?;
    let mut changed = false;
    match name {
        CONFIG_FILE_NAME => {
            let config: LocalResourceConfiguration = serde_json::from_value(value.clone())?;
            validate_configuration(&config)?;
            if let Some(root) = relocated(&config.resource_root, source, destination) {
                let parent = root.parent().ok_or_else(|| {
                    LocalResourceError::InvalidReceipt("资源目录缺少父目录".into())
                })?;
                value["resourceRoot"] = Value::String(path_string(&root));
                value["selectedParent"] = Value::String(path_string(parent));
                changed = true;
            }
            if let Some(candidates) = value
                .get_mut("legacyCandidateRoots")
                .and_then(Value::as_array_mut)
            {
                for candidate in candidates {
                    if let Some(next) = candidate
                        .as_str()
                        .and_then(|path| relocated(path, source, destination))
                    {
                        *candidate = Value::String(path_string(&next));
                        changed = true;
                    }
                }
            }
            validate_configuration(&serde_json::from_value(value.clone())?)?;
        }
        "runtime-settings.json" => {
            if value.get("schemaVersion").is_some() {
                return Err(LocalResourceError::InvalidReceipt(
                    "旧运行时配置含有未知版本，已保留原文件".into(),
                ));
            }
            let legacy: LegacyRuntimeSettingsFile = serde_json::from_value(value.clone())?;
            if let Some(old) = legacy.storage_root.as_deref().map(str::trim) {
                if let Some(next) = relocated(old, source, destination) {
                    if is_legacy_resource_root(Path::new(old)) && !is_legacy_resource_root(&next) {
                        return Err(LocalResourceError::InvalidReceipt(
                            "迁移后资源目录名称不兼容，请先使用资源迁移功能调整位置".into(),
                        ));
                    }
                    value["storageRoot"] = Value::String(path_string(&next));
                    changed = true;
                }
            }
        }
        _ => {
            return Err(LocalResourceError::InvalidReceipt(
                "不支持的资源配置文件".into(),
            ));
        }
    }
    if changed {
        Ok(Some(serde_json::to_vec(&value)?))
    } else {
        Ok(None)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn legacy_resource_root_cannot_change_interpretation_after_move() {
        let temp = tempfile::tempdir().unwrap();
        for name in ["SiaoVPlay", "siaovplay", "SIAOVPLAY"] {
            let source = temp.path().join(name);
            let destination = temp.path().join("renamed");
            let bytes = serde_json::to_vec(&json!({"storageRoot":source})).unwrap();
            assert!(
                relocate_data_config("runtime-settings.json", &bytes, &source, &destination)
                    .is_err(),
                "{name}"
            );
        }
    }

    #[test]
    fn legacy_only_configuration_loads_relocated_resource_root() {
        let temp = tempfile::tempdir().unwrap();
        let source = temp.path().join("old");
        let destination = temp.path().join("new");
        let expected = destination.join("components/SiaoVPlay");
        fs::create_dir_all(&expected).unwrap();
        let bytes = serde_json::to_vec(
            &json!({"storageRoot":source.join("components/SiaoVPlay"),"preferredModel":"base"}),
        )
        .unwrap();
        let updated = relocate_data_config("runtime-settings.json", &bytes, &source, &destination)
            .unwrap()
            .unwrap();
        fs::write(destination.join("runtime-settings.json"), updated).unwrap();
        let manager = LocalResourceManager::load(&destination).unwrap();
        let config = manager.configuration.unwrap();
        assert_eq!(
            Path::new(&config.resource_root),
            dunce::canonicalize(expected).unwrap()
        );
        assert_eq!(config.preferred_profile, "fast");
    }
}
