use std::{
    collections::{HashMap, HashSet},
    path::Path,
};

use rusqlite::TransactionBehavior;
use uuid::Uuid;

use crate::store::{ProjectStore, StoreError};

use super::{
    Collection, CollectionKind, CollectionSortMode, ConfirmLibraryImportInput,
    ConfirmLibraryItemInput, LibraryError, LibraryImportResult, LibraryPreviewStore,
    LibraryScanCandidate, migration,
    preview_store::PreviewLease,
    repository::{LibraryRepository, NewImportedMembership, NewImportedProject, NewLibraryRoot},
    scanner::{self, RevalidatedCandidateFile},
    service::{now_ms, validate_optional_number, validate_title},
};

#[derive(Clone, Debug)]
pub(crate) struct LibraryImportService {
    store: ProjectStore,
    preview_store: LibraryPreviewStore,
}

pub(super) struct PreparedImportItem {
    pub(super) candidate: LibraryScanCandidate,
    pub(super) input: ConfirmLibraryItemInput,
    pub(super) display_title: String,
    pub(super) file: RevalidatedCandidateFile,
    pub(super) path_key: String,
    pub(super) relative_path_key: String,
    pub(super) display_name: String,
}

struct ExistingProjectAtPath {
    project_id: String,
    source_size_bytes: Option<i64>,
    source_modified_at_ms: Option<i64>,
}

impl LibraryImportService {
    pub(crate) fn new(store: ProjectStore, preview_store: LibraryPreviewStore) -> Self {
        Self {
            store,
            preview_store,
        }
    }

    pub(crate) fn confirm_import(
        &self,
        input: ConfirmLibraryImportInput,
    ) -> Result<LibraryImportResult, LibraryError> {
        let lease = self.preview_store.take_preview(&input.preview_token)?;
        match self.confirm_with_lease(&lease, &input) {
            Ok(result) => Ok(result),
            Err(error) => {
                self.preview_store.restore_preview(lease);
                Err(error)
            }
        }
    }

    fn confirm_with_lease(
        &self,
        lease: &PreviewLease,
        input: &ConfirmLibraryImportInput,
    ) -> Result<LibraryImportResult, LibraryError> {
        let preview = lease.preview();
        if preview.preview_token != input.preview_token {
            return Err(LibraryError::Conflict(
                "扫描预览令牌与内存快照不一致".to_owned(),
            ));
        }
        let collection_title = validate_title(&input.collection_title)?;
        let root_display_name = validate_title(&preview.root_display_name)?;
        let canonical_root = scanner::canonicalize_authorized_root(&preview.root_path)?;
        if path_key(&canonical_root) != path_key(Path::new(&preview.root_path)) {
            return Err(LibraryError::Conflict(
                "授权根目录在扫描后发生变化，请重新扫描".to_owned(),
            ));
        }
        let prepared = prepare_items(preview, input, &canonical_root)?;

        let root_id = Uuid::new_v4().to_string();
        let collection_id = Uuid::new_v4().to_string();
        let timestamp = now_ms()?;
        let collection = Collection {
            id: collection_id.clone(),
            kind: CollectionKind::Series,
            title: collection_title,
            root_id: Some(root_id.clone()),
            system_key: None,
            poster_path: None,
            sort_mode: CollectionSortMode::Episode,
            auto_play_next: false,
            last_opened_at_ms: None,
            created_at_ms: timestamp,
            updated_at_ms: timestamp,
        };

        let mut connection = self.store.connect()?;
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let repository = LibraryRepository::new(&transaction);
        let root_path_key = path_key(&canonical_root);
        if repository.root_exists_by_path_key(&root_path_key)? {
            return Err(LibraryError::Conflict(
                "该文件夹已经在媒体库中，请使用重新扫描".to_owned(),
            ));
        }

        let existing_locators = repository.list_primary_media_locators()?;
        let mut projects_by_path = existing_locators
            .into_iter()
            .map(|existing| {
                (
                    path_key(Path::new(&existing.locator)),
                    ExistingProjectAtPath {
                        project_id: existing.project_id,
                        source_size_bytes: existing.source_size_bytes,
                        source_modified_at_ms: existing.source_modified_at_ms,
                    },
                )
            })
            .collect::<HashMap<_, _>>();
        for item in &prepared {
            if let Some(existing) = projects_by_path.get(&item.path_key) {
                let current_size = i64::try_from(item.file.source_size_bytes).map_err(|_| {
                    LibraryError::Validation(format!(
                        "媒体文件大小超出支持范围：{}",
                        item.candidate.relative_path
                    ))
                })?;
                if existing
                    .source_size_bytes
                    .is_some_and(|size| size != current_size)
                    || existing.source_modified_at_ms.is_some()
                        && existing.source_modified_at_ms != item.file.source_modified_at_ms
                {
                    return Err(LibraryError::Conflict(format!(
                        "同路径的既有视频内容已经变化，请先处理媒体变更：{}",
                        item.candidate.relative_path
                    )));
                }
            }
        }
        if !input.confirm_fingerprint_duplicates {
            let existing_fingerprints = repository.list_existing_fingerprints()?;
            for item in &prepared {
                if existing_fingerprints.iter().any(|existing| {
                    existing.quick_fingerprint == item.candidate.quick_fingerprint
                        && path_key(Path::new(&existing.locator)) != item.path_key
                }) {
                    return Err(LibraryError::Conflict(format!(
                        "发现内容指纹相同但路径不同的视频，请人工确认：{}",
                        item.candidate.relative_path
                    )));
                }
            }
        }

        repository.insert_library_root(&NewLibraryRoot {
            id: &root_id,
            path: &preview.root_path,
            path_key: &root_path_key,
            display_name: &root_display_name,
            timestamp,
        })?;
        repository.insert_collection(&collection)?;

        let mut created_project_count = 0_u64;
        let mut reused_project_count = 0_u64;
        for item in &prepared {
            let project_id = if let Some(existing) = projects_by_path.get(&item.path_key) {
                reused_project_count += 1;
                existing.project_id.clone()
            } else {
                let project_id = Uuid::new_v4().to_string();
                let media_source_id = Uuid::new_v4().to_string();
                let source_size_bytes =
                    i64::try_from(item.file.source_size_bytes).map_err(|_| {
                        LibraryError::Validation(format!(
                            "媒体文件大小超出支持范围：{}",
                            item.candidate.relative_path
                        ))
                    })?;
                let locator = item.file.canonical_path.to_string_lossy().into_owned();
                repository.insert_imported_project(&NewImportedProject {
                    project_id: &project_id,
                    media_source_id: &media_source_id,
                    title: &item.display_title,
                    locator: &locator,
                    display_name: &item.display_name,
                    source_size_bytes,
                    source_modified_at_ms: item.file.source_modified_at_ms,
                    timestamp,
                })?;
                projects_by_path.insert(
                    item.path_key.clone(),
                    ExistingProjectAtPath {
                        project_id: project_id.clone(),
                        source_size_bytes: Some(source_size_bytes),
                        source_modified_at_ms: item.file.source_modified_at_ms,
                    },
                );
                created_project_count += 1;
                project_id
            };
            repository.insert_imported_membership(&NewImportedMembership {
                collection_id: &collection_id,
                project_id: &project_id,
                season_number: item.input.season_number,
                episode_number: item.input.episode_number,
                absolute_order: item.input.absolute_order,
                display_title: &item.display_title,
                relative_path: &item.candidate.relative_path,
                relative_path_key: &item.relative_path_key,
                source_size_bytes: i64::try_from(item.file.source_size_bytes).map_err(|_| {
                    LibraryError::Validation(format!(
                        "媒体文件大小超出支持范围：{}",
                        item.candidate.relative_path
                    ))
                })?,
                source_modified_at_ms: item.file.source_modified_at_ms,
                quick_fingerprint: &item.candidate.quick_fingerprint,
                timestamp,
            })?;
        }
        migration::ensure_foreign_keys(&transaction)
            .map_err(StoreError::LibraryMigration)
            .map_err(LibraryError::Store)?;
        let collection_detail = repository.get_collection_detail(&collection_id)?;
        transaction.commit()?;

        Ok(LibraryImportResult {
            root_id,
            collection: collection_detail,
            imported_item_count: prepared.len() as u64,
            created_project_count,
            reused_project_count,
        })
    }
}

pub(super) fn prepare_items(
    preview: &super::LibraryScanPreview,
    input: &ConfirmLibraryImportInput,
    canonical_root: &Path,
) -> Result<Vec<PreparedImportItem>, LibraryError> {
    if preview.candidates.is_empty() {
        return Err(LibraryError::Validation(
            "扫描预览没有可导入的视频".to_owned(),
        ));
    }
    if input.items.len() != preview.candidates.len() {
        return Err(LibraryError::Validation(
            "确认项必须与扫描候选完整对应".to_owned(),
        ));
    }
    let candidates = preview
        .candidates
        .iter()
        .map(|candidate| (candidate.candidate_id.as_str(), candidate))
        .collect::<HashMap<_, _>>();
    let mut candidate_ids = HashSet::new();
    let mut absolute_orders = HashSet::new();
    let mut prepared = Vec::with_capacity(input.items.len());
    for item in &input.items {
        if !candidate_ids.insert(item.candidate_id.as_str()) {
            return Err(LibraryError::Validation(format!(
                "确认项重复：{}",
                item.candidate_id
            )));
        }
        let candidate = candidates
            .get(item.candidate_id.as_str())
            .copied()
            .ok_or_else(|| {
                LibraryError::Validation(format!("确认项不属于该预览：{}", item.candidate_id))
            })?;
        let display_title = validate_title(&item.display_title)?;
        validate_optional_number("季号", item.season_number)?;
        validate_optional_number("集号", item.episode_number)?;
        if item.episode_number.is_none() {
            return Err(LibraryError::Validation(format!(
                "请为待导入视频填写集号：{}",
                candidate.relative_path
            )));
        }
        if item.absolute_order < 0 || !absolute_orders.insert(item.absolute_order) {
            return Err(LibraryError::Validation(
                "单集排序号必须非负且不能重复".to_owned(),
            ));
        }
        let changed = display_title != candidate.display_title
            || item.season_number != candidate.season_number
            || item.episode_number != candidate.episode_number
            || item.absolute_order != candidate.absolute_order;
        if (candidate.needs_confirmation || changed) && !item.confirmed {
            return Err(LibraryError::Conflict(format!(
                "请明确确认单集识别或修正结果：{}",
                candidate.relative_path
            )));
        }
        if candidate.quick_fingerprint.len() != 64
            || !candidate
                .quick_fingerprint
                .bytes()
                .all(|value| value.is_ascii_hexdigit())
        {
            return Err(LibraryError::InvalidData(format!(
                "快速指纹格式无效：{}",
                candidate.relative_path
            )));
        }
        let file = scanner::revalidate_candidate(canonical_root, candidate)?;
        let display_name = file
            .canonical_path
            .file_name()
            .and_then(|value| value.to_str())
            .ok_or_else(|| {
                LibraryError::Validation(format!(
                    "媒体文件名不是有效文本：{}",
                    candidate.relative_path
                ))
            })?
            .to_owned();
        prepared.push(PreparedImportItem {
            candidate: candidate.clone(),
            input: item.clone(),
            display_title,
            path_key: path_key(&file.canonical_path),
            relative_path_key: relative_path_key(&candidate.relative_path),
            display_name,
            file,
        });
    }
    Ok(prepared)
}

pub(super) fn path_key(path: &Path) -> String {
    let value = path.to_string_lossy().replace('/', "\\");
    #[cfg(windows)]
    {
        value.to_lowercase()
    }
    #[cfg(not(windows))]
    {
        value
    }
}

pub(super) fn relative_path_key(path: &str) -> String {
    path.replace('\\', "/").to_lowercase()
}

#[cfg(test)]
mod tests {
    use std::{
        collections::BTreeMap,
        fs,
        path::PathBuf,
        sync::{Arc, Barrier},
        thread,
        time::Duration,
    };

    use sha2::{Digest, Sha256};
    use tempfile::TempDir;
    use uuid::Uuid;

    use crate::domain::CreateLocalProjectInput;

    use super::*;
    use crate::library::{LibraryScanService, ScanLibraryFolderInput};

    struct Fixture {
        temporary: TempDir,
        store: ProjectStore,
        previews: LibraryPreviewStore,
    }

    impl Fixture {
        fn new() -> Self {
            Self::with_previews(LibraryPreviewStore::default())
        }

        fn with_previews(previews: LibraryPreviewStore) -> Self {
            let temporary = tempfile::tempdir().expect("temporary directory should exist");
            let store = ProjectStore::open(temporary.path().join("siaovplay.db"))
                .expect("store should open");
            Self {
                temporary,
                store,
                previews,
            }
        }

        fn root(&self, name: &str) -> std::path::PathBuf {
            let root = self.temporary.path().join(name);
            fs::create_dir_all(&root).expect("library root should exist");
            root
        }

        fn media(&self, root: &Path, name: &str, bytes: &[u8]) -> std::path::PathBuf {
            let path = root.join(name);
            fs::write(&path, bytes).expect("media fixture should be written");
            path
        }

        fn scan(&self, root: &Path) -> super::super::LibraryScanPreview {
            let service = LibraryScanService::new(self.previews.clone());
            let scan_id = Uuid::new_v4().to_string();
            let cancelled = service.begin_scan(&scan_id).expect("scan should start");
            service
                .scan_started(
                    ScanLibraryFolderInput {
                        scan_id,
                        root_path: root.to_string_lossy().into_owned(),
                    },
                    cancelled,
                    |_| {},
                )
                .expect("scan should complete")
        }

        fn input(&self, preview: &super::super::LibraryScanPreview) -> ConfirmLibraryImportInput {
            ConfirmLibraryImportInput {
                preview_token: preview.preview_token.clone(),
                collection_title: preview.suggested_collection_title.clone(),
                items: preview
                    .candidates
                    .iter()
                    .enumerate()
                    .map(|(index, candidate)| ConfirmLibraryItemInput {
                        candidate_id: candidate.candidate_id.clone(),
                        display_title: candidate.display_title.clone(),
                        season_number: candidate.season_number,
                        episode_number: candidate.episode_number.or(Some(index as i64 + 1)),
                        absolute_order: index as i64,
                        confirmed: candidate.needs_confirmation
                            || candidate.episode_number.is_none()
                            || candidate.absolute_order != index as i64,
                    })
                    .collect(),
                confirm_fingerprint_duplicates: false,
            }
        }

        fn service(&self) -> LibraryImportService {
            LibraryImportService::new(self.store.clone(), self.previews.clone())
        }

        fn count(&self, table: &str) -> i64 {
            assert!(matches!(
                table,
                "library_roots" | "collections" | "collection_items" | "projects"
            ));
            self.store
                .connect()
                .expect("database should connect")
                .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
                    row.get(0)
                })
                .expect("row count should load")
        }
    }

    #[test]
    fn confirmed_import_is_atomic_and_consumes_preview_once() {
        let fixture = Fixture::new();
        let root = fixture.root("Series");
        let episode_one = fixture.media(&root, "Series.S01E01.mp4", b"episode-one");
        let episode_two = fixture.media(&root, "Series.S01E02.mkv", b"episode-two");
        let before = [
            fs::read(&episode_one).expect("episode one should read"),
            fs::read(&episode_two).expect("episode two should read"),
        ];
        let preview = fixture.scan(&root);
        let input = fixture.input(&preview);

        let result = fixture
            .service()
            .confirm_import(input.clone())
            .expect("import should succeed");

        assert_eq!(result.imported_item_count, 2);
        assert_eq!(result.created_project_count, 2);
        assert_eq!(result.reused_project_count, 0);
        assert!(!result.collection.summary.collection.auto_play_next);
        assert_eq!(fixture.count("library_roots"), 1);
        assert_eq!(fixture.count("collections"), 1);
        assert_eq!(fixture.count("collection_items"), 2);
        assert_eq!(fixture.count("projects"), 2);
        assert_eq!(
            fs::read(episode_one).expect("episode one should read"),
            before[0]
        );
        assert_eq!(
            fs::read(episode_two).expect("episode two should read"),
            before[1]
        );
        assert!(matches!(
            fixture.service().confirm_import(input),
            Err(LibraryError::PreviewNotFound(_))
        ));
    }

    #[test]
    fn exact_existing_path_reuses_project_without_copying_data() {
        let fixture = Fixture::new();
        let root = fixture.root("Reuse");
        let media_path = fixture.media(&root, "Reuse.S01E01.mp4", b"same-media");
        let project = fixture
            .store
            .create_local_project(CreateLocalProjectInput {
                media_path: media_path.to_string_lossy().into_owned(),
                title: None,
            })
            .expect("existing project should be created");
        let preview = fixture.scan(&root);

        let result = fixture
            .service()
            .confirm_import(fixture.input(&preview))
            .expect("import should reuse project");

        assert_eq!(result.created_project_count, 0);
        assert_eq!(result.reused_project_count, 1);
        assert_eq!(fixture.count("projects"), 1);
        let connection = fixture.store.connect().expect("database should connect");
        let member_project_id: String = connection
            .query_row("SELECT project_id FROM collection_items", [], |row| {
                row.get(0)
            })
            .expect("membership should exist");
        assert_eq!(member_project_id, project.id);
    }

    #[test]
    fn changed_file_rejects_import_and_restores_preview() {
        let fixture = Fixture::new();
        let root = fixture.root("Changed");
        let media_path = fixture.media(&root, "Changed.S01E01.mp4", b"before");
        let preview = fixture.scan(&root);
        let input = fixture.input(&preview);
        fs::write(media_path, b"after-content-is-different").expect("media should change");

        assert!(matches!(
            fixture.service().confirm_import(input.clone()),
            Err(LibraryError::Conflict(_))
        ));
        assert_eq!(fixture.count("library_roots"), 0);
        assert_eq!(fixture.count("collections"), 0);
        assert_eq!(fixture.count("projects"), 0);
        assert!(matches!(
            fixture.service().confirm_import(input),
            Err(LibraryError::Conflict(_))
        ));
    }

    #[test]
    fn fingerprint_duplicate_requires_explicit_confirmation() {
        let fixture = Fixture::new();
        let first_root = fixture.root("First");
        fixture.media(&first_root, "First.S01E01.mp4", b"identical-content");
        let first_preview = fixture.scan(&first_root);
        fixture
            .service()
            .confirm_import(fixture.input(&first_preview))
            .expect("first root should import");

        let second_root = fixture.root("Second");
        fixture.media(&second_root, "Second.S01E01.mp4", b"identical-content");
        let second_preview = fixture.scan(&second_root);
        let mut input = fixture.input(&second_preview);
        assert!(matches!(
            fixture.service().confirm_import(input.clone()),
            Err(LibraryError::Conflict(_))
        ));
        input.confirm_fingerprint_duplicates = true;
        fixture
            .service()
            .confirm_import(input)
            .expect("confirmed duplicate should import");
        assert_eq!(fixture.count("library_roots"), 2);
        assert_eq!(fixture.count("projects"), 2);
    }

    #[test]
    fn expired_preview_is_rejected() {
        let previews = LibraryPreviewStore::with_ttl(Duration::from_millis(1));
        let fixture = Fixture::with_previews(previews);
        let root = fixture.root("Expired");
        fixture.media(&root, "Expired.S01E01.mp4", b"episode");
        let preview = fixture.scan(&root);
        let input = fixture.input(&preview);
        thread::sleep(Duration::from_millis(10));

        assert!(matches!(
            fixture.service().confirm_import(input),
            Err(LibraryError::PreviewExpired(_))
        ));
        assert_eq!(fixture.count("projects"), 0);
    }

    #[test]
    fn database_failure_rolls_back_every_write_and_restores_preview() {
        let fixture = Fixture::new();
        let root = fixture.root("Rollback");
        fixture.media(&root, "Rollback.S01E01.mp4", b"episode");
        let preview = fixture.scan(&root);
        let mut input = fixture.input(&preview);
        input.items[0].display_title = "rollback".to_owned();
        input.items[0].confirmed = true;
        fixture
            .store
            .connect()
            .expect("database should connect")
            .execute_batch(
                "CREATE TRIGGER reject_rollback_membership
                 BEFORE INSERT ON collection_items
                 WHEN NEW.display_title = 'rollback'
                 BEGIN SELECT RAISE(ABORT, 'fixture rollback'); END;",
            )
            .expect("rollback trigger should install");

        assert!(matches!(
            fixture.service().confirm_import(input.clone()),
            Err(LibraryError::Database(_))
        ));
        assert_eq!(fixture.count("library_roots"), 0);
        assert_eq!(fixture.count("collections"), 0);
        assert_eq!(fixture.count("collection_items"), 0);
        assert_eq!(fixture.count("projects"), 0);
        assert!(matches!(
            fixture.service().confirm_import(input),
            Err(LibraryError::Database(_))
        ));
    }

    #[test]
    fn concurrent_confirmation_commits_only_once() {
        let fixture = Fixture::new();
        let root = fixture.root("Concurrent");
        fixture.media(&root, "Concurrent.S01E01.mp4", b"episode");
        let preview = fixture.scan(&root);
        let input = fixture.input(&preview);
        let barrier = Arc::new(Barrier::new(2));
        let handles = (0..2)
            .map(|_| {
                let service = fixture.service();
                let input = input.clone();
                let barrier = Arc::clone(&barrier);
                thread::spawn(move || {
                    barrier.wait();
                    service.confirm_import(input)
                })
            })
            .collect::<Vec<_>>();
        let results = handles
            .into_iter()
            .map(|handle| handle.join().expect("confirmation thread should finish"))
            .collect::<Vec<_>>();

        assert_eq!(results.iter().filter(|result| result.is_ok()).count(), 1);
        assert_eq!(
            results
                .iter()
                .filter(|result| matches!(result, Err(LibraryError::PreviewNotFound(_))))
                .count(),
            1
        );
        assert_eq!(fixture.count("library_roots"), 1);
        assert_eq!(fixture.count("collections"), 1);
        assert_eq!(fixture.count("projects"), 1);
    }

    fn source_manifest(root: &Path) -> BTreeMap<PathBuf, (u64, String)> {
        fn visit(root: &Path, current: &Path, output: &mut BTreeMap<PathBuf, (u64, String)>) {
            for entry in fs::read_dir(current).expect("source directory should read") {
                let entry = entry.expect("source entry should read");
                let path = entry.path();
                if path.is_dir() {
                    visit(root, &path, output);
                } else if path.is_file() {
                    let bytes = fs::read(&path).expect("source file should read");
                    output.insert(
                        path.strip_prefix(root)
                            .expect("source path should stay under root")
                            .to_owned(),
                        (bytes.len() as u64, format!("{:x}", Sha256::digest(bytes))),
                    );
                }
            }
        }

        let mut output = BTreeMap::new();
        visit(root, root, &mut output);
        output
    }

    #[test]
    #[ignore = "requires SIAOVPLAY_LIBRARY_IMPORT_VALIDATION_DIR"]
    fn imports_authorized_validation_directory_without_changing_sources() {
        let root = std::env::var_os("SIAOVPLAY_LIBRARY_IMPORT_VALIDATION_DIR")
            .map(PathBuf::from)
            .expect("SIAOVPLAY_LIBRARY_IMPORT_VALIDATION_DIR should be set");
        let before = source_manifest(&root);
        let fixture = Fixture::new();
        let preview = fixture.scan(&root);
        let input = fixture.input(&preview);

        let result = fixture
            .service()
            .confirm_import(input)
            .expect("validation directory should import");

        assert_eq!(result.imported_item_count, preview.candidates.len() as u64);
        assert_eq!(
            fixture.count("collection_items"),
            preview.candidates.len() as i64
        );
        assert_eq!(source_manifest(&root), before);
    }
}
