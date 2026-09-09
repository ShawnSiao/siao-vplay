use super::*;
use serde_json::json;

fn configuration(root: &Path, candidates: Vec<PathBuf>) -> Vec<u8> {
    serde_json::to_vec(&json!({
        "schemaVersion":1,"selectedParent":root.parent().unwrap(),
        "resourceRoot":root,"preferredProfile":"standard","activeResources":{},
        "legacyCandidateRoots":candidates,"proxyUrl":null,
        "extension":{"pathLikeText":root}
    }))
    .unwrap()
}

#[test]
fn candidates_relocate_by_containment_and_survive_domain_loading() {
    let temp = tempfile::tempdir().unwrap();
    let source = temp.path().join("data");
    let destination = temp.path().join("moved");
    let external = temp.path().join("data-neighbor");
    fs::create_dir_all(&destination).unwrap();
    let bytes = configuration(
        &external.join("SiaoVPlay"),
        vec![source.clone(), source.join("legacy"), external.clone()],
    );
    let updated = relocate_data_config(CONFIG_FILE_NAME, &bytes, &source, &destination)
        .unwrap()
        .unwrap();
    let value: Value = serde_json::from_slice(&updated).unwrap();
    let original: Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(value["extension"], original["extension"]);
    assert_eq!(value["resourceRoot"], original["resourceRoot"]);
    fs::write(destination.join(CONFIG_FILE_NAME), updated).unwrap();
    let manager = LocalResourceManager::load(&destination).unwrap();
    let config = manager.configuration.unwrap();
    let paths: Vec<_> = config
        .legacy_candidate_roots
        .iter()
        .map(PathBuf::from)
        .collect();
    assert_eq!(
        paths,
        vec![destination.clone(), destination.join("legacy"), external]
    );
}

#[test]
fn recovery_sidecars_require_recovery_without_mutating_files() {
    for extension in ["json.bak", "json.part"] {
        let temp = tempfile::tempdir().unwrap();
        let config = temp.path().join(CONFIG_FILE_NAME);
        let sidecar = config.with_extension(extension);
        let bytes = configuration(&temp.path().join("SiaoVPlay"), vec![]);
        fs::write(&sidecar, &bytes).unwrap();
        assert!(ensure_ready_for_data_move(temp.path()).is_err());
        assert!(!config.exists());
        assert_eq!(fs::read(&sidecar).unwrap(), bytes);
        let manager = LocalResourceManager::load(temp.path()).unwrap();
        assert!(manager.configuration.is_some());
        assert!(ensure_ready_for_data_move(temp.path()).is_ok());
        assert_eq!(fs::read(config).unwrap(), bytes);
    }
}

#[test]
fn unsupported_legacy_version_cannot_be_relocated() {
    let temp = tempfile::tempdir().unwrap();
    let bytes =
        serde_json::to_vec(&json!({"schemaVersion":999,"storageRoot":temp.path()})).unwrap();
    assert!(
        relocate_data_config(
            "runtime-settings.json",
            &bytes,
            temp.path(),
            &temp.path().join("new")
        )
        .is_err()
    );
}
