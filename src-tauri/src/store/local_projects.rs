use super::*;

impl ProjectStore {
    pub fn create_local_project(
        &self,
        input: CreateLocalProjectInput,
    ) -> Result<Project, StoreError> {
        self.create_local_project_with_reuse(input, false)
    }

    pub fn open_local_project(
        &self,
        input: CreateLocalProjectInput,
    ) -> Result<Project, StoreError> {
        self.create_local_project_with_reuse(input, true)
    }

    fn create_local_project_with_reuse(
        &self,
        input: CreateLocalProjectInput,
        reuse_existing: bool,
    ) -> Result<Project, StoreError> {
        let media_path = canonical_media_path(&input.media_path)?;
        let display_name = file_display_name(&media_path)?;
        let title = normalize_project_title(input.title.as_deref(), &media_path)?;
        let timestamp = now_ms()?;
        let project_id = Uuid::new_v4().to_string();
        let media_source_id = Uuid::new_v4().to_string();

        let mut connection = self.connect()?;
        let transaction = connection.transaction_with_behavior(if reuse_existing {
            rusqlite::TransactionBehavior::Immediate
        } else {
            rusqlite::TransactionBehavior::Deferred
        })?;
        if reuse_existing {
            let wanted = local_path_key(&media_path);
            let mut statement = transaction.prepare(
                "SELECT p.id, m.locator FROM projects p JOIN media_sources m ON m.project_id = p.id
                 WHERE m.is_primary = 1 AND m.kind = 'local_file'
                 ORDER BY p.last_opened_at_ms DESC, p.id DESC",
            )?;
            let rows = statement.query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })?;
            for row in rows {
                let (id, locator) = row?;
                if local_path_key(Path::new(&locator)) == wanted {
                    return Self::load_project(&transaction, &id);
                }
            }
        }
        transaction.execute(
            "INSERT INTO projects (
                id, title, revision, created_at_ms, updated_at_ms, last_opened_at_ms
             ) VALUES (?1, ?2, 1, ?3, ?3, ?3)",
            params![project_id, title, timestamp],
        )?;
        transaction.execute(
            "INSERT INTO media_sources (
                id, project_id, kind, locator, display_name, is_primary,
                created_at_ms, updated_at_ms
             ) VALUES (?1, ?2, ?3, ?4, ?5, 1, ?6, ?6)",
            params![
                media_source_id,
                project_id,
                MediaSourceKind::LocalFile.as_database_value(),
                path_to_string(&media_path),
                display_name,
                timestamp
            ],
        )?;
        transaction.execute(
            "INSERT INTO playback_states (
                project_id, position_ms, duration_ms, volume, playback_rate,
                subtitle_mode, updated_at_ms
             ) VALUES (?1, 0, NULL, 1.0, 1.0, 'translation', ?2)",
            params![project_id, timestamp],
        )?;
        transaction.commit()?;

        self.get_project(&project_id)
    }
}

fn local_path_key(path: &Path) -> String {
    #[cfg(windows)]
    {
        path.to_string_lossy().replace('/', "\\").to_lowercase()
    }
    #[cfg(not(windows))]
    {
        path.to_string_lossy().into_owned()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn concurrent_open_reuses_one_project_and_preserves_user_state() {
        let temp = tempfile::tempdir().unwrap();
        let media = temp.path().join("Video.mp4");
        fs::write(&media, b"synthetic media").unwrap();
        let store = ProjectStore::open(temp.path().join("projects.db")).unwrap();
        let barrier = std::sync::Arc::new(std::sync::Barrier::new(2));
        let handles = (0..2)
            .map(|_| {
                let store = store.clone();
                let barrier = barrier.clone();
                let path = media.clone();
                std::thread::spawn(move || {
                    barrier.wait();
                    store
                        .open_local_project(CreateLocalProjectInput {
                            media_path: path.to_string_lossy().into_owned(),
                            title: Some("保留标题".to_owned()),
                        })
                        .unwrap()
                })
            })
            .collect::<Vec<_>>();
        let projects = handles
            .into_iter()
            .map(|handle| handle.join().unwrap())
            .collect::<Vec<_>>();
        assert_eq!(projects[0].id, projects[1].id);
        assert_eq!(store.list_projects().unwrap().len(), 1);
        let saved = store
            .update_playback_state(UpdatePlaybackStateInput {
                project_id: projects[0].id.clone(),
                position_ms: 700,
                duration_ms: Some(1000),
                volume: 0.7,
                playback_rate: 1.5,
                subtitle_mode: SubtitleDisplayMode::Bilingual,
                completed: Some(true),
            })
            .unwrap();
        let opened = store
            .open_local_project(CreateLocalProjectInput {
                media_path: media.to_string_lossy().into_owned(),
                title: Some("不覆盖标题".to_owned()),
            })
            .unwrap();
        assert_eq!(opened.id, saved.id);
        assert_eq!(opened.title, "保留标题");
        assert_eq!(opened.playback_state.position_ms, 700);
        assert_eq!(
            opened.playback_state.completed_at_ms,
            saved.playback_state.completed_at_ms
        );
        assert_eq!(opened.media_source.id, saved.media_source.id);
        #[cfg(windows)]
        assert_eq!(
            store
                .open_local_project(CreateLocalProjectInput {
                    media_path: media.to_string_lossy().to_uppercase(),
                    title: None
                })
                .unwrap()
                .id,
            saved.id
        );
    }
}
