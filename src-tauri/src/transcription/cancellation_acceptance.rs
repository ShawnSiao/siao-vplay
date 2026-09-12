use super::*;
use crate::domain::CreateLocalProjectInput;
use std::time::{Duration, Instant};

#[test]
#[ignore = "requires authorized regression media and pinned local transcription assets"]
fn real_transcription_cancel_and_resume_preserves_single_result() {
    let completion_timeout = env::var("SIAOVPLAY_TRANSCRIPTION_ACCEPTANCE_TIMEOUT_SECONDS")
        .map(|value| value.parse::<u64>().expect("acceptance timeout must be seconds"))
        .unwrap_or(180);
    assert!((180..=3600).contains(&completion_timeout));
    let source = PathBuf::from(env::var_os("SIAOVPLAY_TRANSCRIPTION_REGRESSION_MEDIA").unwrap());
    let before = hash_file(&source).unwrap();
    let directory = tempfile::tempdir().unwrap();
    let store = ProjectStore::open(directory.path().join("data/projects/siaovplay.db")).unwrap();
    let project = store
        .create_local_project(CreateLocalProjectInput {
            media_path: source.to_string_lossy().into_owned(),
            title: Some("Transcription cancellation".into()),
        })
        .unwrap();
    let job = start_transcription(
        &store,
        StartTranscriptionInput {
            project_id: project.id.clone(),
            language_code: "auto".into(),
            model_kind: "small".into(),
            confirm_replace_original: false,
        },
    )
    .unwrap();
    spawn_transcription_job(store.clone(), job.id.clone()).unwrap();
    let deadline = Instant::now() + Duration::from_secs(90);
    loop {
        let state = get_transcription_job(&store, &job.id).unwrap();
        let log = job_directory(&store, &job.id)
            .unwrap()
            .join("whisper-vulkan.log");
        if state.status.as_str() == "transcribing" && fs::metadata(log).is_ok_and(|m| m.len() > 0) {
            break;
        }
        assert!(!matches!(
            state.status.as_str(),
            "failed" | "completed" | "cancelled"
        ), "transcription stopped before cancellation: {state:?}");
        assert!(Instant::now() < deadline, "transcription did not start");
        thread::sleep(Duration::from_millis(50));
    }
    for id in ["ffmpeg-cpu", "whisper-cpu", "whisper-model-small"] {
        assert!(crate::resource_leases::maintain_resource(id).is_err(), "running transcription left {id} unprotected");
    }
    assert!(crate::resource_leases::maintain_all().is_err());
    cancel_transcription_job(&store, &job.id).unwrap();
    let deadline = Instant::now() + Duration::from_secs(15);
    while get_transcription_job(&store, &job.id)
        .unwrap()
        .status
        .as_str()
        != "cancelled"
    {
        assert!(Instant::now() < deadline, "transcription did not cancel");
        thread::sleep(Duration::from_millis(50));
    }
    assert!(
        subtitles::list_subtitle_versions(&store, &project.id)
            .unwrap()
            .is_empty()
    );
    let deadline = Instant::now() + Duration::from_secs(5);
    while crate::resource_leases::maintain_all().is_err() {
        assert!(Instant::now() < deadline, "cancelled transcription retained resource leases");
        thread::sleep(Duration::from_millis(20));
    }
    assert_eq!(
        resume_transcription_job(&store, &job.id).unwrap().id,
        job.id
    );
    spawn_transcription_job(store.clone(), job.id.clone()).unwrap();
    let deadline = Instant::now() + Duration::from_secs(completion_timeout);
    loop {
        let state = get_transcription_job(&store, &job.id).unwrap();
        if state.status.as_str() == "completed" {
            break;
        }
        assert!(!matches!(
            state.status.as_str(),
            "failed" | "cancelled" | "interrupted"
        ), "resumed transcription stopped: {state:?}");
        assert!(
            Instant::now() < deadline,
            "resumed transcription did not finish"
        );
        thread::sleep(Duration::from_millis(100));
    }
    let reopened = ProjectStore::open(store.database_path()).unwrap();
    let versions = subtitles::list_subtitle_versions(&reopened, &project.id).unwrap();
    assert_eq!(versions.len(), 1);
    assert!(!versions[0].segments.is_empty());
    assert!(resume_transcription_job(&reopened, &job.id).is_err());
    assert_eq!(hash_file(&source).unwrap(), before);
}
