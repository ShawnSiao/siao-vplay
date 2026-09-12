use super::*;
use crate::domain::CreateLocalProjectInput;
use std::time::{Duration, Instant};

#[test]
#[ignore = "requires authorized SIAOVPLAY_BURN_CANCEL_MEDIA and the supported FFmpeg runtime"]
fn real_running_burn_cancels_and_resumes_without_partial_delivery() {
    let source = PathBuf::from(std::env::var_os("SIAOVPLAY_BURN_CANCEL_MEDIA").unwrap());
    let before = hash_file(&source).unwrap();
    let directory = tempfile::tempdir().unwrap();
    let store = ProjectStore::open(directory.path().join("data/projects/siaovplay.db")).unwrap();
    let project = store
        .create_local_project(CreateLocalProjectInput {
            media_path: path_to_string(&source),
            title: Some("Cancellation acceptance".into()),
        })
        .unwrap();
    let inspected = media::inspect_project_media(&store, &project.id).unwrap();
    let (original, translation) = tests::insert_subtitle_fixture(
        &store,
        &project.id,
        &inspected.source_sha256,
        inspected.probe.duration_ms.unwrap(),
    );
    let destination = directory.path().join("exports");
    fs::create_dir(&destination).unwrap();
    let job = start_subtitle_burn(
        &store,
        StartSubtitleBurnInput {
            project_id: project.id.clone(),
            mode: SubtitleBurnMode::Bilingual,
            source_version_id: Some(original),
            translation_version_id: translation,
            destination_directory: path_to_string(&destination),
            style: SubtitleBurnStyle {
                text_size: SubtitleBurnTextSize::Medium,
                position_y: 0.96,
            },
            confirm_version_selection: true,
        },
    )
    .unwrap();
    let stored = load_stored_job(&store, &job.id).unwrap();
    spawn_subtitle_burn_job(store.clone(), job.id.clone()).unwrap();
    let deadline = Instant::now() + Duration::from_secs(60);
    loop {
        let state = get_subtitle_burn_job(&store, &job.id).unwrap();
        if state.status == "running"
            && fs::metadata(&stored.temporary_output_path).is_ok_and(|m| m.len() > 0)
        {
            break;
        }
        assert!(!matches!(
            state.status.as_str(),
            "failed" | "completed" | "cancelled"
        ));
        assert!(Instant::now() < deadline, "encoder did not start output");
        thread::sleep(Duration::from_millis(20));
    }
    assert!(crate::resource_leases::maintain_resource("ffmpeg-cpu").is_err());
    assert!(crate::resource_leases::maintain_all().is_err());
    cancel_subtitle_burn_job(&store, &job.id).unwrap();
    let deadline = Instant::now() + Duration::from_secs(15);
    while get_subtitle_burn_job(&store, &job.id).unwrap().status != "cancelled" {
        assert!(Instant::now() < deadline, "running encoder did not cancel");
        thread::sleep(Duration::from_millis(50));
    }
    assert!(!stored.temporary_output_path.exists());
    assert!(!stored.intended_output_path.exists());
    assert!(!stored.intended_manifest_path.exists());
    let deadline = Instant::now() + Duration::from_secs(5);
    while crate::resource_leases::maintain_resource("ffmpeg-cpu").is_err() {
        assert!(Instant::now() < deadline, "cancelled burn retained its resource lease");
        thread::sleep(Duration::from_millis(20));
    }
    let resumed = resume_subtitle_burn_job(&store, &job.id).unwrap();
    assert_eq!(resumed.id, job.id);
    spawn_subtitle_burn_job(store.clone(), job.id.clone()).unwrap();
    let deadline = Instant::now() + Duration::from_secs(180);
    let completed = loop {
        let state = get_subtitle_burn_job(&store, &job.id).unwrap();
        if state.status == "completed" {
            break state;
        }
        assert!(!matches!(
            state.status.as_str(),
            "failed" | "cancelled" | "interrupted"
        ));
        assert!(Instant::now() < deadline, "resumed burn did not finish");
        thread::sleep(Duration::from_millis(100));
    };
    let output = PathBuf::from(completed.output_path.unwrap());
    media::validate_media_path(&output).unwrap();
    assert_eq!(hash_file(&output).unwrap(), completed.output_sha256.unwrap());
    assert!(PathBuf::from(completed.manifest_path.unwrap()).is_file());
    assert!(!stored.intended_output_path.exists());
    assert_eq!(hash_file(&source).unwrap(), before);
}
