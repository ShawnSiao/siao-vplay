use serde::Serialize;
use sha2::{Digest, Sha256};
use std::io;

pub(crate) fn fingerprint(
    domain: &str,
    configuration: &impl Serialize,
    plan: &impl Serialize,
    receipts: &impl Serialize,
) -> Result<String, serde_json::Error> {
    let bytes = serde_json::to_vec(&(1, domain, configuration, plan, receipts))?;
    Ok(format!("{:x}", Sha256::digest(bytes)))
}

pub(crate) fn verify(expected: &str, actual: &str) -> io::Result<()> {
    if expected.len() != 64 || !expected.bytes().all(|byte| byte.is_ascii_hexdigit()) || expected != actual {
        return Err(io::Error::new(io::ErrorKind::InvalidInput,
            "资源清理计划已变化，请重新检查清理清单并确认"));
    }
    Ok(())
}

pub(crate) fn candidate_bytes(install: &std::path::Path, sizes: impl Iterator<Item = u64>) -> Option<u64> {
    install.is_dir().then(|| sizes.fold(0_u64, u64::saturating_add))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn changed_reviewed_state_prevents_any_file_mutation() {
        let root = tempfile::tempdir().unwrap();
        let asset = root.path().join("resource"); std::fs::write(&asset, b"retained").unwrap();
        let baseline = fingerprint("unused", &"root-a", &vec!["a"], &("v1", "payload", 12)).unwrap();
        let variants = [
            fingerprint("old", &"root-a", &vec!["a"], &("v1", "payload", 12)).unwrap(),
            fingerprint("unused", &"root-b", &vec!["a"], &("v1", "payload", 12)).unwrap(),
            fingerprint("unused", &"root-a", &vec!["a", "b"], &("v1", "payload", 12)).unwrap(),
            fingerprint("unused", &"root-a", &vec!["a"], &("v2", "payload", 12)).unwrap(),
            fingerprint("unused", &"root-a", &vec!["a"], &("v1", "other", 12)).unwrap(),
            fingerprint("unused", &"root-a", &vec!["a"], &("v1", "payload", 13)).unwrap(),
        ];
        for current in variants {
            let result = verify(&baseline, &current).and_then(|()| std::fs::remove_file(&asset));
            assert!(result.is_err()); assert_eq!(std::fs::read(&asset).unwrap(), b"retained");
        }
        assert!(verify("", &baseline).is_err());
        assert!(verify(&baseline, &baseline).is_ok());
    }
    #[test]
    fn cleanup_commands_require_the_reviewed_fingerprint() {
        assert!(serde_json::from_value::<crate::resource_migration::CleanupUnusedResourcesInput>(
            serde_json::json!({"confirmed": true})).is_err());
        assert!(serde_json::from_value::<crate::resource_diagnostics::CleanupOldResourceVersionsInput>(
            serde_json::json!({"confirmed": true})).is_err());
    }

    #[test]
    fn absent_installation_does_not_contribute_to_cleanup_estimate() {
        let root = tempfile::tempdir().unwrap();
        assert_eq!(candidate_bytes(&root.path().join("absent"), [12, 8].into_iter()), None);
        let file = root.path().join("not-a-directory"); std::fs::write(&file, b"keep").unwrap();
        assert_eq!(candidate_bytes(&file, [12, 8].into_iter()), None);
        assert_eq!(candidate_bytes(root.path(), [12, 8].into_iter()), Some(20));
        assert_eq!(std::fs::read(&file).unwrap(), b"keep");
    }

}
