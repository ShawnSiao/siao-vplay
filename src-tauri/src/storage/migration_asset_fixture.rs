use crate::{
    learning,
    library::{AddProjectToCollectionInput, CreateCollectionInput, LibraryService},
    store::ProjectStore,
    subtitles::{
        self, GeneratedSubtitleCue, PersistTranscriptionInput, ReviseSubtitleVersionInput,
        SubtitleCue,
    },
};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{fs, path::Path};

pub(super) struct Assets {
    project_id: String,
    versions: Value,
    card_id: String,
    card: Value,
    collection_id: String,
}

impl Assets {
    pub(super) fn seed(store: &ProjectStore, project_id: &str) -> Self {
        let project = store.get_project(project_id).unwrap();
        store.record_media_probe(project_id, &project.media_source.id, &"a".repeat(64),
            r#"{"containerFormats":["mov"],"durationMs":10000,"sizeBytes":22,"bitRate":null,"videoStreams":[],"audioStreams":[],"subtitleStreams":[]}"#, 22, Some(1)).unwrap();
        let path = store.data_directory().join("captions.srt");
        fs::write(
            &path,
            "1\n00:00:00,000 --> 00:00:01,500\nA retained sentence.\n",
        )
        .unwrap();
        // Domain persistence fixture: no transcription or media runtime is executed.
        let original = subtitles::persist_transcription(
            store,
            PersistTranscriptionInput {
                project_id: project_id.into(),
                source_label: "fixture.vtt".into(),
                source_sha256: "b".repeat(64),
                language_code: "en".into(),
                expected_project_revision: store.get_project(project_id).unwrap().revision,
                expected_media_sha256: "a".repeat(64),
                media_duration_ms: Some(10000),
                cues: vec![GeneratedSubtitleCue {
                    cue: SubtitleCue {
                        ordinal: 1,
                        start_ms: 0,
                        end_ms: 1500,
                        text: "A retained sentence.".into(),
                        confidence: Some(0.9),
                    },
                    words: vec![],
                }],
            },
        )
        .unwrap();
        subtitles::revise_subtitle_version(
            store,
            ReviseSubtitleVersionInput {
                project_id: project_id.into(),
                base_version_id: original.id.clone(),
                expected_project_revision: original.project_revision,
                segment_edits: vec![],
                global_replacement: None,
                offset_ms: 100,
            },
        )
        .unwrap();
        let card_id = uuid::Uuid::new_v4().to_string();
        let screenshot = store.data_directory().join("learning-cards/retained.jpg");
        fs::create_dir_all(screenshot.parent().unwrap()).unwrap();
        let bytes = b"isolated screenshot bytes, not a real image";
        fs::write(&screenshot, bytes).unwrap();
        // Persist a card whose optional dictionary result has already been removed.
        // Exercise asset retention and the real read API without dispatching an AI task.
        store.connect().unwrap().execute(
            "INSERT INTO learning_cards(id,project_id,source_version_id,source_segment_id,selected_text,selection_kind,pronunciation,part_of_speech,contextual_meaning,usage_note,source_sentence,translated_sentence,language_code,playback_position_ms,screenshot_path,screenshot_sha256,created_at_ms,updated_at_ms) VALUES (?1,?2,?3,?4,'retained','word','retained','verb','保留','fixture note','A retained sentence.','保留的句子','en',500,?5,?6,1,2)",
            rusqlite::params![card_id, project_id, original.id, original.segments[0].id, screenshot.to_string_lossy(), format!("{:x}", Sha256::digest(bytes))],
        ).unwrap();
        let library = LibraryService::new(store.clone());
        let collection = library
            .create_collection(CreateCollectionInput {
                title: "Retained manual collection".into(),
            })
            .unwrap();
        library
            .add_project_to_collection(AddProjectToCollectionInput {
                collection_id: collection.id.clone(),
                project_id: project_id.into(),
                season_number: Some(1),
                episode_number: Some(2),
                absolute_order: Some(3),
                display_title: Some("Retained episode".into()),
            })
            .unwrap();
        Self {
            project_id: project_id.into(),
            versions: serde_json::to_value(
                subtitles::list_subtitle_versions(store, project_id).unwrap(),
            )
            .unwrap(),
            card: serde_json::to_value(learning::get_learning_card(store, &card_id).unwrap())
                .unwrap(),
            card_id,
            collection_id: collection.id,
        }
    }

    pub(super) fn verify(&self, store: &ProjectStore) {
        assert_eq!(
            serde_json::to_value(
                subtitles::list_subtitle_versions(store, &self.project_id).unwrap()
            )
            .unwrap(),
            self.versions
        );
        let card = learning::get_learning_card(store, &self.card_id).unwrap();
        assert!(card.screenshot_available);
        assert_eq!(
            Path::new(&card.screenshot_path),
            store.data_directory().join("learning-cards/retained.jpg")
        );
        let mut actual = serde_json::to_value(card).unwrap();
        actual["screenshotPath"] = self.card["screenshotPath"].clone();
        assert_eq!(actual, self.card);
        let connection = store.connect().unwrap();
        let count: i64 = connection
            .query_row("SELECT count(*) FROM pragma_foreign_key_check", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(count, 0);
        let library = LibraryService::new(store.clone());
        let detail = library.get_collection_detail(&self.collection_id).unwrap();
        assert_eq!(
            detail.summary.collection.title,
            "Retained manual collection"
        );
        let episodes = library
            .list_collection_episodes(&self.collection_id, None)
            .unwrap();
        assert_eq!(episodes.len(), 1);
        let episode = &episodes[0];
        assert_eq!(episode.project_id, self.project_id);
        assert_eq!(episode.episode_title.as_deref(), Some("Retained episode"));
        assert_eq!(episode.season_number, Some(1));
        assert_eq!(episode.episode_number, Some(2));
        assert_eq!(episode.absolute_order, Some(3));
    }
}
