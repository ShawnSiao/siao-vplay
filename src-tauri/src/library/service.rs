use std::time::{SystemTime, UNIX_EPOCH};

use uuid::Uuid;

use crate::store::ProjectStore;

use super::{
    AddProjectToCollectionInput, Collection, CollectionDetail, CollectionKind, CollectionSortMode,
    CreateCollectionInput, EpisodeNeighbors, LibraryCollectionDeletionResult, LibraryError,
    LibraryHome, LibraryRootRevokeResult, LibraryRootStatus, MediaSummary, SearchResult,
    UpdateCollectionInput,
    repository::{LibraryRepository, NewMembership},
};

const WATCH_LATER_KEY: &str = "watch_later";
const WATCH_LATER_TITLE: &str = "稍后观看";
const HOME_CONTINUE_LIMIT: i64 = 12;
const HOME_UNCLASSIFIED_LIMIT: i64 = 24;
const HOME_RECENTLY_ADDED_LIMIT: i64 = 5;
const SEARCH_LIMIT: i64 = 50;
const MAX_TITLE_CHARS: usize = 200;

#[derive(Clone, Debug)]
pub(crate) struct LibraryService {
    store: ProjectStore,
}

impl LibraryService {
    pub(crate) fn new(store: ProjectStore) -> Self {
        Self { store }
    }

    pub(crate) fn get_home(&self) -> Result<LibraryHome, LibraryError> {
        let connection = self.store.connect()?;
        let repository = LibraryRepository::new(&connection);
        let (total_project_count, collection_item_count, unclassified_count) =
            repository.counts()?;
        Ok(LibraryHome {
            continue_watching: repository.list_continue_watching(HOME_CONTINUE_LIMIT)?,
            collections: repository.list_collection_summaries()?,
            folders: repository.list_roots()?,
            unclassified: repository.list_unclassified(HOME_UNCLASSIFIED_LIMIT)?,
            recently_added: repository.list_recently_added(HOME_RECENTLY_ADDED_LIMIT)?,
            total_project_count,
            collection_item_count,
            unclassified_count,
        })
    }

    pub(crate) fn search(&self, query: &str) -> Result<Vec<SearchResult>, LibraryError> {
        let query = query.trim();
        if query.is_empty() {
            return Ok(Vec::new());
        }
        if query.chars().count() > MAX_TITLE_CHARS {
            return Err(LibraryError::Validation(format!(
                "搜索内容不能超过 {MAX_TITLE_CHARS} 个字符"
            )));
        }
        let pattern = format!("%{}%", escape_like_pattern(query));
        let connection = self.store.connect()?;
        LibraryRepository::new(&connection).search(&pattern, SEARCH_LIMIT)
    }

    pub(crate) fn create_collection(
        &self,
        input: CreateCollectionInput,
    ) -> Result<Collection, LibraryError> {
        let timestamp = now_ms()?;
        let collection = Collection {
            id: Uuid::new_v4().to_string(),
            kind: CollectionKind::Manual,
            title: validate_title(&input.title)?,
            root_id: None,
            system_key: None,
            poster_path: None,
            sort_mode: CollectionSortMode::Manual,
            auto_play_next: false,
            last_opened_at_ms: None,
            created_at_ms: timestamp,
            updated_at_ms: timestamp,
        };
        let mut connection = self.store.connect()?;
        let transaction = connection.transaction()?;
        LibraryRepository::new(&transaction).insert_collection(&collection)?;
        transaction.commit()?;
        Ok(collection)
    }

    pub(crate) fn update_collection(
        &self,
        input: UpdateCollectionInput,
    ) -> Result<Collection, LibraryError> {
        validate_id("集合", &input.collection_id)?;
        let mut connection = self.store.connect()?;
        let transaction = connection.transaction()?;
        let repository = LibraryRepository::new(&transaction);
        let mut collection = repository.get_collection(&input.collection_id)?;
        if collection.system_key.is_some() && input.title.is_some() {
            return Err(LibraryError::Conflict("系统集合名称不能修改".to_owned()));
        }
        if let Some(title) = input.title {
            collection.title = validate_title(&title)?;
        }
        if let Some(sort_mode) = input.sort_mode {
            collection.sort_mode = sort_mode;
        }
        if let Some(auto_play_next) = input.auto_play_next {
            collection.auto_play_next = auto_play_next;
        }
        collection.updated_at_ms = now_ms()?;
        repository.update_collection(&collection)?;
        transaction.commit()?;
        Ok(collection)
    }

    pub(crate) fn delete_collection(
        &self,
        collection_id: &str,
    ) -> Result<LibraryCollectionDeletionResult, LibraryError> {
        validate_id("集合", collection_id)?;
        let mut connection = self.store.connect()?;
        let transaction = connection.transaction()?;
        let repository = LibraryRepository::new(&transaction);
        let collection = repository.get_collection(collection_id)?;
        if collection.system_key.is_some() {
            return Err(LibraryError::Conflict("系统集合不能删除".to_owned()));
        }
        let preserved_project_count = repository.collection_item_count(collection_id)?;
        if let Some(root_id) = collection.root_id.as_deref() {
            repository.snapshot_collection_to_root(root_id, collection_id)?;
        }
        repository.delete_collection(collection_id)?;
        let root_status = collection
            .root_id
            .as_deref()
            .map(|root_id| repository.root_status(root_id))
            .transpose()?;
        transaction.commit()?;
        Ok(LibraryCollectionDeletionResult {
            collection_id: collection_id.to_owned(),
            root_id: collection.root_id.clone(),
            preserved_project_count,
            root_status,
        })
    }

    pub(crate) fn revoke_library_root(
        &self,
        root_id: &str,
    ) -> Result<LibraryRootRevokeResult, LibraryError> {
        validate_id("文件夹", root_id)?;
        let timestamp = now_ms()?;
        let mut connection = self.store.connect()?;
        let transaction =
            connection.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        let repository = LibraryRepository::new(&transaction);
        let status = repository.root_status(root_id)?;
        if status == LibraryRootStatus::Ambiguous {
            return Err(LibraryError::Conflict(
                "该文件夹关联多个剧集，暂不支持自动撤销授权，请先手动整理。".to_owned(),
            ));
        }
        let preserved_project_count = match status {
            LibraryRootStatus::Linked => repository.count_root_projects(root_id)?,
            LibraryRootStatus::Orphaned | LibraryRootStatus::Ambiguous => {
                repository.list_root_manifest_items(root_id)?.len() as i64
            }
        };
        let detached_collection_count =
            repository.detach_root_collections(root_id, timestamp)? as u64;
        repository.delete_library_root(root_id)?;
        transaction.commit()?;
        Ok(LibraryRootRevokeResult {
            root_id: root_id.to_owned(),
            detached_collection_count,
            preserved_project_count: preserved_project_count as u64,
        })
    }

    pub(crate) fn get_collection_detail(
        &self,
        collection_id: &str,
    ) -> Result<CollectionDetail, LibraryError> {
        validate_id("集合", collection_id)?;
        let connection = self.store.connect()?;
        LibraryRepository::new(&connection).get_collection_detail(collection_id)
    }

    pub(crate) fn project_media_location(&self, project_id: &str) -> Result<String, LibraryError> {
        validate_id("视频", project_id)?;
        let connection = self.store.connect()?;
        LibraryRepository::new(&connection).project_media_locator(project_id)
    }

    pub(crate) fn list_collection_episodes(
        &self,
        collection_id: &str,
        season_number: Option<i64>,
    ) -> Result<Vec<MediaSummary>, LibraryError> {
        validate_id("集合", collection_id)?;
        validate_optional_number("季号", season_number)?;
        let connection = self.store.connect()?;
        LibraryRepository::new(&connection).list_collection_episodes(collection_id, season_number)
    }

    pub(crate) fn add_project_to_collection(
        &self,
        input: AddProjectToCollectionInput,
    ) -> Result<CollectionDetail, LibraryError> {
        validate_id("集合", &input.collection_id)?;
        validate_id("视频", &input.project_id)?;
        validate_optional_number("季号", input.season_number)?;
        validate_optional_number("集号", input.episode_number)?;
        validate_optional_number("排序号", input.absolute_order)?;

        let collection_id = input.collection_id.clone();
        let mut connection = self.store.connect()?;
        let transaction = connection.transaction()?;
        let repository = LibraryRepository::new(&transaction);
        let collection = repository.get_collection(&input.collection_id)?;
        if collection.root_id.is_some() {
            return Err(LibraryError::Conflict(
                "文件夹剧集不能手动添加视频，请使用「扫描更新」或「重建剧集」。".to_owned(),
            ));
        }
        let project_title = repository.project_title(&input.project_id)?;
        if repository.membership_exists(&input.collection_id, &input.project_id)? {
            return Err(LibraryError::MembershipExists {
                collection_id: input.collection_id,
                project_id: input.project_id,
            });
        }
        let display_title = match input.display_title {
            Some(value) => validate_title(&value)?,
            None => project_title,
        };
        let absolute_order = input
            .absolute_order
            .unwrap_or(repository.next_absolute_order(&input.collection_id)?);
        repository.insert_membership(
            &NewMembership {
                collection_id: &input.collection_id,
                project_id: &input.project_id,
                season_number: input.season_number,
                episode_number: input.episode_number,
                absolute_order,
                display_title: &display_title,
            },
            now_ms()?,
        )?;
        transaction.commit()?;
        self.get_collection_detail(&collection_id)
    }

    pub(crate) fn remove_project_from_collection(
        &self,
        collection_id: &str,
        project_id: &str,
    ) -> Result<CollectionDetail, LibraryError> {
        validate_id("集合", collection_id)?;
        validate_id("视频", project_id)?;
        let mut connection = self.store.connect()?;
        let transaction = connection.transaction()?;
        let repository = LibraryRepository::new(&transaction);
        let collection = repository.get_collection(collection_id)?;
        if collection.root_id.is_some() {
            repository.remove_root_item(collection.root_id.as_deref(), project_id)?;
        }
        repository.remove_membership(collection_id, project_id)?;
        transaction.commit()?;
        self.get_collection_detail(collection_id)
    }

    pub(crate) fn get_episode_neighbors(
        &self,
        collection_id: &str,
        project_id: &str,
    ) -> Result<EpisodeNeighbors, LibraryError> {
        validate_id("集合", collection_id)?;
        validate_id("视频", project_id)?;
        let connection = self.store.connect()?;
        let episodes =
            LibraryRepository::new(&connection).list_episode_references(collection_id)?;
        let index = episodes
            .iter()
            .position(|episode| episode.project_id == project_id)
            .ok_or_else(|| LibraryError::MembershipNotFound {
                collection_id: collection_id.to_owned(),
                project_id: project_id.to_owned(),
            })?;
        Ok(EpisodeNeighbors {
            previous: index.checked_sub(1).map(|value| episodes[value].clone()),
            next: episodes.get(index + 1).cloned(),
        })
    }

    pub(crate) fn set_watch_later(
        &self,
        project_id: &str,
        enabled: bool,
    ) -> Result<Option<CollectionDetail>, LibraryError> {
        validate_id("视频", project_id)?;
        let mut connection = self.store.connect()?;
        let transaction = connection.transaction()?;
        let repository = LibraryRepository::new(&transaction);
        let timestamp = now_ms()?;
        let existing_collection = repository.get_system_collection(WATCH_LATER_KEY)?;
        if !enabled && existing_collection.is_none() {
            repository.project_title(project_id)?;
            transaction.commit()?;
            return Ok(None);
        }
        let collection = match existing_collection {
            Some(collection) => collection,
            None => {
                let collection = Collection {
                    id: Uuid::new_v4().to_string(),
                    kind: CollectionKind::Manual,
                    title: WATCH_LATER_TITLE.to_owned(),
                    root_id: None,
                    system_key: Some(WATCH_LATER_KEY.to_owned()),
                    poster_path: None,
                    sort_mode: CollectionSortMode::AddedAt,
                    auto_play_next: false,
                    last_opened_at_ms: None,
                    created_at_ms: timestamp,
                    updated_at_ms: timestamp,
                };
                repository.insert_collection(&collection)?;
                collection
            }
        };
        let exists = repository.membership_exists(&collection.id, project_id)?;
        if enabled && !exists {
            let title = repository.project_title(project_id)?;
            repository.insert_membership(
                &NewMembership {
                    collection_id: &collection.id,
                    project_id,
                    season_number: None,
                    episode_number: None,
                    absolute_order: repository.next_absolute_order(&collection.id)?,
                    display_title: &title,
                },
                timestamp,
            )?;
        } else if !enabled && exists {
            repository.remove_membership(&collection.id, project_id)?;
        } else if enabled {
            repository.project_title(project_id)?;
        }
        transaction.commit()?;
        self.get_collection_detail(&collection.id).map(Some)
    }
}

pub(super) fn validate_title(value: &str) -> Result<String, LibraryError> {
    let title = value.trim();
    if title.is_empty() {
        return Err(LibraryError::Validation("名称不能为空".to_owned()));
    }
    if title.chars().count() > MAX_TITLE_CHARS {
        return Err(LibraryError::Validation(format!(
            "名称不能超过 {MAX_TITLE_CHARS} 个字符"
        )));
    }
    Ok(title.to_owned())
}

fn validate_id(label: &str, value: &str) -> Result<(), LibraryError> {
    Uuid::parse_str(value)
        .map(|_| ())
        .map_err(|_| LibraryError::Validation(format!("{label} ID 无效")))
}

pub(super) fn validate_optional_number(
    label: &str,
    value: Option<i64>,
) -> Result<(), LibraryError> {
    if value.is_some_and(|number| number < 0) {
        return Err(LibraryError::Validation(format!("{label}不能小于 0")));
    }
    Ok(())
}

fn escape_like_pattern(value: &str) -> String {
    value
        .replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_")
}

pub(super) fn now_ms() -> Result<i64, LibraryError> {
    let duration = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| LibraryError::Conflict(format!("系统时间早于 Unix 纪元：{error}")))?;
    i64::try_from(duration.as_millis())
        .map_err(|_| LibraryError::Conflict("系统时间超出支持范围".to_owned()))
}

#[cfg(test)]
mod tests {
    use std::{fs, path::Path};

    use rusqlite::params;
    use tempfile::TempDir;

    use super::*;
    use crate::{
        domain::{CreateLocalProjectInput, Project},
        library::{
            LibraryRootStatus,
            repository::{LibraryRepository, NewImportedMembership, NewLibraryRoot},
        },
    };

    struct Fixture {
        temporary: TempDir,
        service: LibraryService,
    }

    impl Fixture {
        fn new() -> Self {
            let temporary = tempfile::tempdir().expect("temporary directory should exist");
            let store = ProjectStore::open(temporary.path().join("siaovplay.db"))
                .expect("store should open");
            Self {
                temporary,
                service: LibraryService::new(store),
            }
        }

        fn project(&self, name: &str) -> Project {
            let path = self.temporary.path().join(name);
            fs::write(&path, b"media").expect("media fixture should be written");
            self.service
                .store
                .create_local_project(CreateLocalProjectInput {
                    media_path: path.to_string_lossy().into_owned(),
                    title: None,
                })
                .expect("project should be created")
        }

        fn collection(&self, title: &str) -> Collection {
            self.service
                .create_collection(CreateCollectionInput {
                    title: title.to_owned(),
                })
                .expect("collection should be created")
        }

        fn imported_collection(&self, title: &str) -> Collection {
            let timestamp = now_ms().expect("timestamp should be available");
            let root_id = Uuid::new_v4().to_string();
            let collection = Collection {
                id: Uuid::new_v4().to_string(),
                kind: CollectionKind::Series,
                title: title.to_owned(),
                root_id: Some(root_id.clone()),
                system_key: None,
                poster_path: None,
                sort_mode: CollectionSortMode::Episode,
                auto_play_next: false,
                last_opened_at_ms: None,
                created_at_ms: timestamp,
                updated_at_ms: timestamp,
            };
            let mut connection = self.service.store.connect().expect("store should connect");
            let transaction = connection.transaction().expect("transaction should begin");
            let repository = LibraryRepository::new(&transaction);
            let root_path = self.temporary.path().to_string_lossy().into_owned();
            repository
                .insert_library_root(&NewLibraryRoot {
                    id: &root_id,
                    path: &root_path,
                    path_key: &root_path,
                    display_name: title,
                    timestamp,
                })
                .expect("root should insert");
            repository
                .insert_collection(&collection)
                .expect("series collection should insert");
            transaction.commit().expect("transaction should commit");
            collection
        }

        fn add_imported(&self, collection: &Collection, project: &Project, order: i64) {
            let metadata =
                fs::metadata(&project.media_source.locator).expect("project media should exist");
            let relative_path = Path::new(&project.media_source.locator)
                .file_name()
                .and_then(|value| value.to_str())
                .expect("fixture media should have a name")
                .to_owned();
            let fingerprint = "a".repeat(64);
            let timestamp = now_ms().expect("timestamp should be available");
            let mut connection = self.service.store.connect().expect("store should connect");
            let transaction = connection.transaction().expect("transaction should begin");
            LibraryRepository::new(&transaction)
                .insert_imported_membership(&NewImportedMembership {
                    collection_id: &collection.id,
                    project_id: &project.id,
                    season_number: Some(1),
                    episode_number: Some(order + 1),
                    absolute_order: order,
                    display_title: &project.title,
                    relative_path: &relative_path,
                    relative_path_key: &relative_path.to_ascii_lowercase(),
                    source_size_bytes: i64::try_from(metadata.len()).expect("size should fit"),
                    source_modified_at_ms: None,
                    quick_fingerprint: &fingerprint,
                    timestamp,
                })
                .expect("imported membership should insert");
            transaction.commit().expect("transaction should commit");
        }

        fn add(
            &self,
            collection: &Collection,
            project: &Project,
            season: i64,
            episode: i64,
            order: i64,
        ) {
            self.service
                .add_project_to_collection(AddProjectToCollectionInput {
                    collection_id: collection.id.clone(),
                    project_id: project.id.clone(),
                    season_number: Some(season),
                    episode_number: Some(episode),
                    absolute_order: Some(order),
                    display_title: None,
                })
                .expect("membership should be added");
        }
    }

    #[test]
    fn collection_crud_preserves_projects_and_updates_home_counts() {
        let fixture = Fixture::new();
        let project = fixture.project("episode-01.mp4");
        let mut collection = fixture.collection("第一季");

        let home = fixture.service.get_home().expect("home should load");
        assert_eq!(home.total_project_count, 1);
        assert_eq!(home.unclassified_count, 1);
        assert_eq!(home.recently_added.len(), 1);
        assert_eq!(home.unclassified[0].project_id, project.id);

        fixture.add(&collection, &project, 1, 1, 0);
        let home = fixture.service.get_home().expect("home should reload");
        assert_eq!(home.collection_item_count, 1);
        assert_eq!(home.unclassified_count, 0);
        assert!(home.unclassified.is_empty());
        assert_eq!(home.recently_added.len(), 1);
        assert_eq!(home.recently_added[0].project_id, project.id);

        collection = fixture
            .service
            .update_collection(UpdateCollectionInput {
                collection_id: collection.id,
                title: Some("重命名后的第一季".to_owned()),
                sort_mode: Some(CollectionSortMode::Episode),
                auto_play_next: Some(true),
            })
            .expect("collection should update");
        assert_eq!(collection.title, "重命名后的第一季");
        assert!(collection.auto_play_next);

        fixture
            .service
            .delete_collection(&collection.id)
            .expect("collection should delete");
        assert_eq!(
            fixture
                .service
                .store
                .get_project(&project.id)
                .expect("project should remain")
                .id,
            project.id
        );
        assert_eq!(
            fixture
                .service
                .get_home()
                .expect("home should reload")
                .unclassified_count,
            1
        );
    }

    #[test]
    fn deleting_imported_collection_preserves_root_manifest_and_marks_root_orphaned() {
        let fixture = Fixture::new();
        let project = fixture.project("episode-01.mp4");
        let collection = fixture.imported_collection("导入剧集");
        fixture.add_imported(&collection, &project, 0);

        let result = fixture
            .service
            .delete_collection(&collection.id)
            .expect("imported collection should delete");

        assert_eq!(result.preserved_project_count, 1);
        assert_eq!(result.root_status, Some(LibraryRootStatus::Orphaned));
        assert!(fixture.service.store.get_project(&project.id).is_ok());
        let home = fixture.service.get_home().expect("home should reload");
        assert_eq!(home.unclassified_count, 1);
        assert_eq!(home.folders.len(), 1);
        assert_eq!(home.folders[0].status, LibraryRootStatus::Orphaned);

        let connection = fixture
            .service
            .store
            .connect()
            .expect("store should connect");
        let manifest_count: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM library_root_items WHERE root_id = ?1",
                params![result.root_id.expect("root should be returned")],
                |row| row.get(0),
            )
            .expect("root manifest should be readable");
        assert_eq!(manifest_count, 1);
    }

    #[test]
    fn removing_one_membership_keeps_project_and_other_memberships() {
        let fixture = Fixture::new();
        let project = fixture.project("shared.mp4");
        let first = fixture.collection("合集 A");
        let second = fixture.collection("合集 B");
        fixture.add(&first, &project, 1, 1, 0);
        fixture.add(&second, &project, 1, 1, 0);

        fixture
            .service
            .remove_project_from_collection(&first.id, &project.id)
            .expect("membership should be removed");
        assert!(fixture.service.store.get_project(&project.id).is_ok());
        assert!(
            fixture
                .service
                .list_collection_episodes(&first.id, None)
                .expect("first collection should load")
                .is_empty()
        );
        assert_eq!(
            fixture
                .service
                .list_collection_episodes(&second.id, None)
                .expect("second collection should load")
                .len(),
            1
        );
        assert_eq!(
            fixture
                .service
                .get_home()
                .expect("home should load")
                .unclassified_count,
            0
        );
    }

    #[test]
    fn revoking_linked_root_detaches_collection_without_deleting_projects() {
        let fixture = Fixture::new();
        let project = fixture.project("linked.mp4");
        let collection = fixture.imported_collection("已关联剧集");
        fixture.add_imported(&collection, &project, 0);

        let result = fixture
            .service
            .revoke_library_root(collection.root_id.as_deref().expect("root id"))
            .expect("root should revoke");
        assert_eq!(result.detached_collection_count, 1);
        assert_eq!(result.preserved_project_count, 1);
        let connection = fixture.service.store.connect().expect("connection");
        let root_id: Option<String> = connection
            .query_row(
                "SELECT root_id FROM collections WHERE id = ?1",
                params![collection.id],
                |row| row.get(0),
            )
            .expect("collection should remain");
        assert!(root_id.is_none());
        let membership_count: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM collection_items WHERE collection_id = ?1",
                params![collection.id],
                |row| row.get(0),
            )
            .expect("membership should remain");
        assert_eq!(membership_count, 1);
        assert!(fixture.service.store.get_project(&project.id).is_ok());
        assert!(
            fixture
                .service
                .get_home()
                .expect("home should load")
                .folders
                .is_empty()
        );
    }

    #[test]
    fn revoking_orphaned_root_removes_authorization_but_keeps_projects() {
        let fixture = Fixture::new();
        let project = fixture.project("orphaned.mp4");
        let collection = fixture.imported_collection("孤立剧集");
        fixture.add_imported(&collection, &project, 0);
        let deletion = fixture
            .service
            .delete_collection(&collection.id)
            .expect("collection should delete");
        let result = fixture
            .service
            .revoke_library_root(deletion.root_id.as_deref().expect("root id"))
            .expect("orphaned root should revoke");
        assert_eq!(result.detached_collection_count, 0);
        assert_eq!(result.preserved_project_count, 1);
        assert!(fixture.service.store.get_project(&project.id).is_ok());
        assert!(
            fixture
                .service
                .get_home()
                .expect("home should load")
                .folders
                .is_empty()
        );
    }

    #[test]
    fn neighbors_follow_stable_cross_season_order() {
        let fixture = Fixture::new();
        let collection = fixture.collection("剧集");
        let first = fixture.project("S01E01.mp4");
        let second = fixture.project("S01E02.mp4");
        let third = fixture.project("S02E01.mp4");
        fixture.add(&collection, &third, 2, 1, 2);
        fixture.add(&collection, &first, 1, 1, 0);
        fixture.add(&collection, &second, 1, 2, 1);

        let neighbors = fixture
            .service
            .get_episode_neighbors(&collection.id, &second.id)
            .expect("neighbors should load");
        assert_eq!(neighbors.previous.expect("previous").project_id, first.id);
        assert_eq!(neighbors.next.expect("next").project_id, third.id);

        let boundary = fixture
            .service
            .get_episode_neighbors(&collection.id, &first.id)
            .expect("boundary should load");
        assert!(boundary.previous.is_none());
    }

    #[test]
    fn watch_later_is_unique_idempotent_and_not_deletable() {
        let fixture = Fixture::new();
        let project = fixture.project("watch-later.mp4");
        fixture
            .service
            .set_watch_later(&project.id, false)
            .expect("removing absent watch later should be harmless");
        assert!(
            fixture
                .service
                .get_home()
                .expect("home should load")
                .collections
                .is_empty()
        );
        fixture
            .service
            .set_watch_later(&project.id, true)
            .expect("watch later should add");
        fixture
            .service
            .set_watch_later(&project.id, true)
            .expect("repeat add should be harmless");

        let home = fixture.service.get_home().expect("home should load");
        let watch_later = home
            .collections
            .iter()
            .find(|value| value.collection.system_key.as_deref() == Some(WATCH_LATER_KEY))
            .expect("watch later collection should exist");
        assert_eq!(watch_later.item_count, 1);
        assert!(!watch_later.collection.auto_play_next);
        assert!(matches!(
            fixture
                .service
                .delete_collection(&watch_later.collection.id),
            Err(LibraryError::Conflict(_))
        ));

        fixture
            .service
            .set_watch_later(&project.id, false)
            .expect("watch later should remove");
        fixture
            .service
            .set_watch_later(&project.id, false)
            .expect("repeat remove should be harmless");
    }

    #[test]
    fn search_matches_collection_episode_and_escaped_wildcards() {
        let fixture = Fixture::new();
        let collection = fixture.collection("100% 剧集");
        let project = fixture.project("pilot_episode.mp4");
        fixture.add(&collection, &project, 1, 1, 0);

        let collection_results = fixture.service.search("100%").expect("search should work");
        assert_eq!(collection_results.len(), 1);
        assert_eq!(
            collection_results[0].collection_id.as_deref(),
            Some(collection.id.as_str())
        );

        let media_results = fixture
            .service
            .search("pilot_")
            .expect("search should work");
        assert_eq!(media_results.len(), 1);
        assert_eq!(
            media_results[0].project_id.as_deref(),
            Some(project.id.as_str())
        );
        assert!(
            fixture
                .service
                .search("   ")
                .expect("empty search")
                .is_empty()
        );
    }

    #[test]
    fn media_summary_reports_missing_files_without_deleting_data() {
        let fixture = Fixture::new();
        let project = fixture.project("offline.mp4");
        fs::remove_file(Path::new(&project.media_source.locator)).expect("fixture should delete");

        let home = fixture.service.get_home().expect("home should load");
        assert!(!home.unclassified[0].media_available);
        assert!(fixture.service.store.get_project(&project.id).is_ok());
    }
}
