use std::{
    fs::{self, File, OpenOptions},
    io,
    path::Path,
};

pub(crate) const LOCK_FILE_NAME: &str = ".siaovplay-instance.lock";

/// Kept alive for the application lifetime; the empty file is not user data.
pub(crate) struct InstanceLock {
    _file: File,
}

impl InstanceLock {
    pub(crate) fn acquire(directory: &Path) -> io::Result<Self> {
        fs::create_dir_all(directory)?;
        let mut options = OpenOptions::new();
        options.read(true).write(true).create(true).truncate(false);
        #[cfg(windows)]
        {
            use std::os::windows::fs::OpenOptionsExt;
            // Share reads/writes, but forbid deleting the locked file and opening
            // a replacement inode while this process still owns the old one.
            options.share_mode(3);
        }
        let file = options.open(directory.join(LOCK_FILE_NAME))?;
        file.try_lock().map_err(io::Error::from)?;
        Ok(Self { _file: file })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        path::PathBuf,
        time::{SystemTime, UNIX_EPOCH},
    };

    struct Fixture(PathBuf);
    impl Fixture {
        fn new() -> Self {
            let stamp = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let path =
                std::env::temp_dir().join(format!("siaovplay-lock-{}-{stamp}", std::process::id()));
            fs::create_dir(&path).unwrap();
            Self(path)
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn excludes_a_second_owner_and_releases_on_drop() {
        let directory = Fixture::new();
        let owner = InstanceLock::acquire(&directory.0).unwrap();
        assert!(InstanceLock::acquire(&directory.0.join(".")).is_err());
        drop(owner);
        assert!(InstanceLock::acquire(&directory.0).is_ok());
    }

    #[test]
    fn excludes_another_process() {
        let directory = Fixture::new();
        let _owner = InstanceLock::acquire(&directory.0).unwrap();
        let status = std::process::Command::new(std::env::current_exe().unwrap())
            .args(["child_probe", "--ignored", "--nocapture"])
            .env("SIAOVPLAY_LOCK_TEST_DIRECTORY", &directory.0)
            .status()
            .unwrap();
        assert!(status.success());
    }

    #[test]
    #[ignore = "subprocess probe, invoked by excludes_another_process"]
    fn child_probe() {
        let directory =
            std::env::var_os("SIAOVPLAY_LOCK_TEST_DIRECTORY").expect("isolated fixture path");
        assert!(InstanceLock::acquire(Path::new(&directory)).is_err());
    }
}
