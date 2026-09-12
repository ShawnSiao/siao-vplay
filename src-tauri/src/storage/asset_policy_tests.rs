use super::*;

fn policy() -> serde_json::Value {
    serde_json::from_str(include_str!("asset-policy.json")).unwrap()
}

#[test]
fn bundled_policy_retains_browser_profile_and_protects_unknown_files() {
    let parsed = parse(&policy().to_string()).unwrap();
    assert!(parsed.preserve_unknown);
    assert_eq!(bootstrap_retained_names().unwrap(), vec!["EBWebView"]);
}

#[test]
fn unsupported_versions_and_unknown_file_deletion_are_rejected() {
    for (key, value) in [
        ("schemaVersion", serde_json::json!(2)),
        ("preserveUnknown", serde_json::json!(false)),
    ] {
        let mut data = policy();
        data[key] = value;
        assert!(parse(&data.to_string()).is_err());
    }
}

#[test]
fn unsafe_paths_and_duplicate_ids_are_rejected() {
    for path in ["../assets", "/assets", "C:/assets", "a\\b", "a//b", "a/./b"] {
        let mut data = policy();
        data["rules"][0]["path"] = serde_json::json!(path);
        assert!(parse(&data.to_string()).is_err(), "{path}");
    }
    let mut data = policy();
    data["rules"][1]["id"] = data["rules"][0]["id"].clone();
    assert!(parse(&data.to_string()).is_err());
}

#[test]
fn credentials_and_user_assets_cannot_be_reclassified_as_rebuildable() {
    for id in ["api-credentials", "remote-media", "project-database"] {
        let mut data = policy();
        let rule = data["rules"]
            .as_array_mut()
            .unwrap()
            .iter_mut()
            .find(|rule| rule["id"] == id)
            .unwrap();
        rule["transfer"] = serde_json::json!("managed_copy_or_rebuild");
        assert!(parse(&data.to_string()).is_err());
    }
}
