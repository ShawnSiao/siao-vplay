use super::*;

#[test]
fn scan_rejects_directory_junction_before_reading_external_files() {
    let directory = tempfile::tempdir().unwrap();
    let source = directory.path().join("source");
    let external = directory.path().join("external");
    fs::create_dir(&source).unwrap();
    fs::create_dir(&external).unwrap();
    fs::write(external.join("private.txt"), b"retain").unwrap();
    let junction = source.join("linked");
    let output = std::process::Command::new("cmd.exe")
        .args(["/D", "/C", "mklink", "/J"])
        .arg(&junction).arg(&external).output().unwrap();
    assert!(output.status.success(), "{}", String::from_utf8_lossy(&output.stderr));
    let result = scan_files(&source, None);
    // Remove only the link, never recurse into the external directory.
    fs::remove_dir(&junction).unwrap();
    assert!(matches!(result, Err(StorageError::MigrationIntegrity(_))), "{result:?}");
    assert_eq!(fs::read(external.join("private.txt")).unwrap(), b"retain");
}
