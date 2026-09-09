use super::*;
#[test]
fn source_changed_during_queue_wait_is_rejected_without_modifying_it() {
    let temp = tempfile::tempdir().unwrap();
    let source = temp.path().join("source.mp4");
    fs::write(&source, b"original fixture").unwrap();
    let cancel = crate::cancellable_process::Cancellation::default();
    let expected = hash_file_controlled(&source, &cancel).unwrap();
    fs::write(&source, b"changed while queued").unwrap();
    assert!(matches!(
        verify_proxy_source(&source, &expected, &cancel),
        Err(MediaError::SourceChanged)
    ));
    assert_eq!(fs::read(&source).unwrap(), b"changed while queued");
}
#[test]
fn source_verification_is_cancellable_and_accepts_unchanged_bytes() {
    let temp = tempfile::tempdir().unwrap();
    let source = temp.path().join("source.mp4");
    fs::write(&source, b"fixture").unwrap();
    let cancel = crate::cancellable_process::Cancellation::default();
    let expected = hash_file_controlled(&source, &cancel).unwrap();
    assert!(verify_proxy_source(&source, &expected, &cancel).is_ok());
    cancel.cancel();
    assert!(verify_proxy_source(&source, &expected, &cancel).is_err());
}
