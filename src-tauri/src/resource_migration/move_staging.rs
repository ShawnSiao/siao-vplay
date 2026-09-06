use super::{ResourceMigrationError, move_io};
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
};

// A stable, destination-local receipt permits resuming a killed copy without
// trusting arbitrary pre-existing directories. It contains no user assets.
pub(super) struct Staging {
    pub path: PathBuf,
    receipt: PathBuf,
}

impl Staging {
    pub fn open(source: &Path, target: &Path) -> Result<Self, ResourceMigrationError> {
        let parent = target
            .parent()
            .ok_or_else(|| ResourceMigrationError::InvalidSource("目标没有父目录".into()))?;
        move_io::validate_destination(source, parent)?;
        let source = dunce::canonicalize(source)?;
        let parent = dunce::canonicalize(parent)?;
        let target = parent.join(
            target
                .file_name()
                .ok_or_else(|| ResourceMigrationError::InvalidSource("目标目录无效".into()))?,
        );
        let identity = serde_json::to_vec(&serde_json::json!({
            "protocol": "siaovplay-resource-copy-v1", "source": source, "target": target,
        }))?;
        let key = format!("{:x}", Sha256::digest(&identity));
        let path = parent.join(format!(".SiaoVPlay-moving-{key}"));
        let receipt = parent.join(format!(".SiaoVPlay-moving-{key}.json"));
        let invalid = || {
            ResourceMigrationError::Integrity(
                "复制恢复记录或临时目录不匹配，未修改该目录；请选择其他保存位置".into(),
            )
        };
        if let Ok(metadata) = fs::symlink_metadata(&path) {
            if metadata.file_type().is_symlink() || !metadata.is_dir() || !receipt.is_file() {
                return Err(invalid());
            }
        }
        match fs::symlink_metadata(&receipt) {
            Ok(metadata) => {
                if metadata.file_type().is_symlink()
                    || !metadata.is_file()
                    || metadata.len() > 16_384
                {
                    return Err(invalid());
                }
                let mut bytes = Vec::new();
                fs::File::open(&receipt)?
                    .take(16_385)
                    .read_to_end(&mut bytes)?;
                if bytes != identity {
                    return Err(invalid());
                }
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                let mut file = fs::OpenOptions::new()
                    .create_new(true)
                    .write(true)
                    .open(&receipt)?;
                file.write_all(&identity)?;
                file.sync_all()?;
            }
            Err(error) => return Err(error.into()),
        }
        fs::create_dir_all(&path)?;
        Ok(Self { path, receipt })
    }

    pub fn finish(self) {
        // A stale receipt is harmless; never turn a successful location switch
        // into a failure because its small recovery record cannot be removed.
        let _ = fs::remove_file(self.receipt);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn killed_copy_can_resume_with_only_remaining_disk_space() {
        const CHILD_ROOT: &str = "SIAOVPLAY_TEST_KILLED_RESOURCE_COPY";
        if let Some(root) = std::env::var_os(CHILD_ROOT) {
            let root = PathBuf::from(root);
            let staging =
                Staging::open(&root.join("source"), &root.join("destination/SiaoVPlay")).unwrap();
            fs::write(staging.path.join("complete"), b"verified").unwrap();
            fs::write(staging.path.join("partial"), b"part").unwrap();
            fs::File::options()
                .write(true)
                .open(staging.path.join("complete"))
                .unwrap()
                .set_times(
                    fs::FileTimes::new()
                        .set_modified(std::time::UNIX_EPOCH + std::time::Duration::from_secs(60)),
                )
                .unwrap();
            fs::write(root.join("ready"), b"ready").unwrap();
            loop {
                std::thread::park();
            }
        }
        let fixture = tempfile::tempdir().unwrap();
        let source = fixture.path().join("source");
        let target = fixture.path().join("destination/SiaoVPlay");
        fs::create_dir_all(&source).unwrap();
        fs::create_dir_all(target.parent().unwrap()).unwrap();
        fs::write(source.join("complete"), b"verified").unwrap();
        fs::write(source.join("partial"), b"complete contents").unwrap();
        let mut command = std::process::Command::new(std::env::current_exe().unwrap());
        command.args(["--exact", "resource_migration::move_staging::tests::killed_copy_can_resume_with_only_remaining_disk_space"])
            .env(CHILD_ROOT, fixture.path()).stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x08000000);
        }
        let mut child = command.spawn().unwrap();
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
        while !fixture.path().join("ready").exists() && std::time::Instant::now() < deadline {
            std::thread::sleep(std::time::Duration::from_millis(10));
        }
        let ready = fixture.path().join("ready").exists();
        let _ = child.kill();
        child.wait().unwrap();
        assert!(ready, "child must reach the interrupted-copy checkpoint");
        let staging = Staging::open(&source, &target).unwrap();
        let before = fs::metadata(staging.path.join("complete"))
            .unwrap()
            .modified()
            .unwrap();
        let verified = super::super::copy_root_verified_inner(
            &source,
            &staging.path,
            super::super::MoveCopyOptions {
                available_bytes: Some(
                    super::super::MOVE_MARGIN_BYTES + b"complete contents".len() as u64,
                ),
                cross_volume: true,
                fault: super::super::MoveFault::None,
            },
            true,
        )
        .unwrap();
        assert_eq!(verified.files, 2);
        assert_eq!(
            fs::metadata(staging.path.join("complete"))
                .unwrap()
                .modified()
                .unwrap(),
            before
        );
        assert_eq!(
            move_io::manifest(&source).unwrap(),
            move_io::manifest(&staging.path).unwrap()
        );
        assert!(source.join("complete").is_file());
    }

    #[test]
    fn reopening_after_interruption_reuses_only_the_bound_staging_directory() {
        let fixture = tempfile::tempdir().unwrap();
        let source = fixture.path().join("source");
        let parent = fixture.path().join("destination");
        fs::create_dir_all(&source).unwrap();
        fs::create_dir_all(&parent).unwrap();
        let target = parent.join("SiaoVPlay");
        let first = Staging::open(&source, &target).unwrap();
        fs::write(first.path.join("partial"), b"retained").unwrap();
        let next = Staging::open(&source, &target).unwrap();
        assert_eq!(first.path, next.path);
        assert_eq!(fs::read(next.path.join("partial")).unwrap(), b"retained");
        fs::write(&next.receipt, b"another copy").unwrap();
        assert!(Staging::open(&source, &target).is_err());
        assert_eq!(fs::read(next.path.join("partial")).unwrap(), b"retained");
    }
}
