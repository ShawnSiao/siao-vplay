use std::{
    collections::{HashMap, HashSet},
    path::{Path, PathBuf},
    sync::atomic::AtomicBool,
};

use rusqlite::TransactionBehavior;
use uuid::Uuid;

use crate::store::{ProjectStore, StoreError};

use super::{
    ApplyLibraryRescanInput, ApplyLibraryRootRebuildInput, ApplyLibraryRootRelocationInput,
    ConfirmLibraryImportInput, ItemAvailability, LibraryError, LibraryRecoveryItem,
    LibraryRecoveryStore, LibraryRelocationMismatch, LibraryRescanPreview, LibraryRescanResult,
    LibraryRootRebuildItem, LibraryRootRebuildMatchKind, LibraryRootRebuildPreview,
    LibraryRootRebuildResult, LibraryRootRelocationPreview, LibraryRootRelocationResult,
    LibraryScanPreview, RelocationMismatchReason, migration,
    recovery_store::RecoveryLease,
    repository::{
        ExistingMediaLocator, LibraryRepository, LibraryRootItemRecord, NewImportedMembership,
        NewImportedProject, NewRootItem, NewRootMembership, RootMembershipRecord,
    },
    scanner,
    service::{now_ms, validate_title},
};

use super::import_service::{path_key, prepare_items, relative_path_key};

#[derive(Clone, Debug)]
pub(crate) struct LibraryRecoveryService {
    store: ProjectStore,
    previews: LibraryRecoveryStore,
}

struct ExistingProjectAtPath {
    project_id: String,
    source_size_bytes: Option<i64>,
    source_modified_at_ms: Option<i64>,
}

impl LibraryRecoveryService {
    pub(crate) fn new(store: ProjectStore, previews: LibraryRecoveryStore) -> Self {
        Self { store, previews }
    }

    pub(crate) fn inspect_rescan(
        &self,
        root_id: &str,
    ) -> Result<LibraryRescanPreview, LibraryError> {
        let preview = self.build_rescan_snapshot(root_id)?;
        self.previews.store_rescan(preview)
    }

    pub(crate) fn apply_rescan(
        &self,
        input: ApplyLibraryRescanInput,
    ) -> Result<LibraryRescanResult, LibraryError> {
        let lease = self.previews.take(&input.preview_token)?;
        match self.apply_rescan_lease(&lease, &input) {
            Ok(result) => Ok(result),
            Err(error) => {
                self.previews.restore(lease);
                Err(error)
            }
        }
    }

    pub(crate) fn inspect_rebuild(
        &self,
        input: super::InspectLibraryRootRebuildInput,
    ) -> Result<LibraryRootRebuildPreview, LibraryError> {
        let preview =
            self.build_rebuild_snapshot(&input.root_id, input.new_root_path.as_deref())?;
        self.previews.store_rebuild(preview)
    }

    pub(crate) fn apply_rebuild(
        &self,
        input: ApplyLibraryRootRebuildInput,
    ) -> Result<LibraryRootRebuildResult, LibraryError> {
        let lease = self.previews.take(&input.preview_token)?;
        match self.apply_rebuild_lease(&lease, &input) {
            Ok(result) => Ok(result),
            Err(error) => {
                self.previews.restore(lease);
                Err(error)
            }
        }
    }

    pub(crate) fn inspect_relocation(
        &self,
        root_id: &str,
        new_root_path: &str,
    ) -> Result<LibraryRootRelocationPreview, LibraryError> {
        let preview = self.build_relocation_snapshot(root_id, new_root_path)?;
        self.previews.store_relocation(preview)
    }

    pub(crate) fn apply_relocation(
        &self,
        input: ApplyLibraryRootRelocationInput,
    ) -> Result<LibraryRootRelocationResult, LibraryError> {
        let lease = self.previews.take(&input.preview_token)?;
        match self.apply_relocation_lease(&lease) {
            Ok(result) => Ok(result),
            Err(error) => {
                self.previews.restore(lease);
                Err(error)
            }
        }
    }

    fn build_rescan_snapshot(&self, root_id: &str) -> Result<LibraryRescanPreview, LibraryError> {
        let connection = self.store.connect()?;
        let repository = LibraryRepository::new(&connection);
        let root = repository.get_root(root_id)?;
        let collection_id = repository.root_collection_id(root_id)?;
        let items = repository.list_root_items(root_id)?;
        if !Path::new(&root.path).is_dir() {
            return Ok(LibraryRescanPreview {
                preview_token: String::new(),
                root_id: root_id.to_owned(),
                root_path: root.path,
                root_display_name: root.display_name,
                collection_id,
                root_offline: true,
                new_candidates: Vec::new(),
                missing_items: Vec::new(),
                changed_items: Vec::new(),
                available_item_count: 0,
                ignored_count: 0,
                expires_at_ms: 0,
            });
        }
        let scanned = scan_root(&root.path)?;
        if path_key(Path::new(&scanned.root_path)) != root.path_key {
            return Err(LibraryError::Conflict(
                "授权根目录解析结果已经变化，请先执行根目录重定位".to_owned(),
            ));
        }
        let candidates_by_key = scanned
            .candidates
            .iter()
            .map(|candidate| (relative_path_key(&candidate.relative_path), candidate))
            .collect::<HashMap<_, _>>();
        let existing_keys = items
            .iter()
            .filter_map(|item| item.relative_path_key.clone())
            .collect::<HashSet<_>>();
        let mut missing_items = Vec::new();
        let mut changed_items = Vec::new();
        let mut available_item_count = 0_u64;
        for item in &items {
            let Some(relative_key) = item.relative_path_key.as_deref() else {
                return Err(LibraryError::InvalidData(format!(
                    "根目录成员缺少相对路径：{}",
                    item.project_id
                )));
            };
            let Some(expected_fingerprint) = item.quick_fingerprint.as_deref() else {
                return Err(LibraryError::InvalidData(format!(
                    "根目录成员缺少快速指纹：{}",
                    item.project_id
                )));
            };
            match candidates_by_key.get(relative_key) {
                None => missing_items.push(recovery_item(item)?),
                Some(candidate) if candidate.quick_fingerprint != expected_fingerprint => {
                    changed_items.push(recovery_item(item)?);
                }
                Some(_) => available_item_count += 1,
            }
        }
        let existing_fingerprints = repository
            .list_existing_fingerprints()?
            .into_iter()
            .map(|existing| existing.quick_fingerprint)
            .collect::<HashSet<_>>();
        let mut new_candidates = scanned
            .candidates
            .into_iter()
            .filter(|candidate| {
                !existing_keys.contains(&relative_path_key(&candidate.relative_path))
            })
            .collect::<Vec<_>>();
        for candidate in &mut new_candidates {
            if existing_fingerprints.contains(&candidate.quick_fingerprint) {
                candidate.needs_confirmation = true;
                candidate.confirmation_reason =
                    Some("内容指纹与既有单集相同，但相对路径不同".to_owned());
            }
        }
        Ok(LibraryRescanPreview {
            preview_token: String::new(),
            root_id: root_id.to_owned(),
            root_path: scanned.root_path,
            root_display_name: scanned.root_display_name,
            collection_id,
            root_offline: false,
            new_candidates,
            missing_items,
            changed_items,
            available_item_count,
            ignored_count: scanned.ignored_count,
            expires_at_ms: 0,
        })
    }

    fn build_rebuild_snapshot(
        &self,
        root_id: &str,
        requested_root_path: Option<&str>,
    ) -> Result<LibraryRootRebuildPreview, LibraryError> {
        let connection = self.store.connect()?;
        let repository = LibraryRepository::new(&connection);
        let root = repository.get_root(root_id)?;
        let status = repository.root_status(root_id)?;
        match status {
            super::LibraryRootStatus::Linked => {
                return Err(LibraryError::Conflict(
                    "该文件夹已经关联剧集，请使用「扫描更新」".to_owned(),
                ));
            }
            super::LibraryRootStatus::Ambiguous => {
                return Err(LibraryError::Conflict(
                    "该文件夹关联多个剧集，暂不支持自动重建，请手动整理。".to_owned(),
                ));
            }
            super::LibraryRootStatus::Orphaned => {}
        }

        let manifest = repository.list_root_manifest_items(root_id)?;
        if manifest.is_empty() {
            drop(connection);
            self.backfill_legacy_root_manifest(root_id, &root.path)?;
        }
        let connection = self.store.connect()?;
        let repository = LibraryRepository::new(&connection);
        let manifest = repository.list_root_manifest_items(root_id)?;
        let target_path = match requested_root_path {
            Some(path) => scanner::canonicalize_authorized_root(path)?,
            None => PathBuf::from(&root.path),
        };
        let target_path_key = path_key(&target_path);
        if target_path_key != root.path_key
            && repository.root_path_key_exists_elsewhere(root_id, &target_path_key)?
        {
            return Err(LibraryError::Conflict(
                "新的文件夹已经授权给其他媒体库".to_owned(),
            ));
        }

        if !target_path.is_dir() {
            return Ok(LibraryRootRebuildPreview {
                preview_token: String::new(),
                root_id: root_id.to_owned(),
                current_root_path: root.path,
                root_path: target_path.to_string_lossy().into_owned(),
                root_display_name: root.display_name.clone(),
                suggested_collection_title: root.display_name,
                root_offline: true,
                new_candidates: Vec::new(),
                matched_items: Vec::new(),
                missing_items: manifest
                    .iter()
                    .map(|item| {
                        rebuild_item(item, None, LibraryRootRebuildMatchKind::Missing, None)
                    })
                    .collect::<Result<Vec<_>, _>>()?,
                changed_items: Vec::new(),
                uncertain_items: Vec::new(),
                ignored_count: 0,
                expires_at_ms: 0,
            });
        }

        let scanned = scan_root(&target_path.to_string_lossy())?;
        let candidates_by_key = scanned
            .candidates
            .iter()
            .map(|candidate| (relative_path_key(&candidate.relative_path), candidate))
            .collect::<HashMap<_, _>>();
        let mut consumed_candidate_keys = HashSet::new();
        let mut matched_items = Vec::new();
        let mut missing_items = Vec::new();
        let mut changed_items = Vec::new();
        let mut uncertain_items = Vec::new();
        for item in &manifest {
            let Some(relative_path) = item.relative_path.as_deref() else {
                uncertain_items.push(rebuild_item(
                    item,
                    None,
                    LibraryRootRebuildMatchKind::NeedsConfirmation,
                    Some("历史清单缺少相对路径，请人工确认对应文件".to_owned()),
                )?);
                continue;
            };
            if !is_safe_relative_path(relative_path) {
                uncertain_items.push(rebuild_item(
                    item,
                    None,
                    LibraryRootRebuildMatchKind::NeedsConfirmation,
                    Some("历史清单中的相对路径不安全，请人工确认".to_owned()),
                )?);
                continue;
            }
            let key = relative_path_key(relative_path);
            match candidates_by_key.get(&key) {
                None => missing_items.push(rebuild_item(
                    item,
                    None,
                    LibraryRootRebuildMatchKind::Missing,
                    None,
                )?),
                Some(candidate) => {
                    consumed_candidate_keys.insert(key);
                    let (kind, reason) = match item.quick_fingerprint.as_deref() {
                        Some(expected) if expected == candidate.quick_fingerprint => {
                            (LibraryRootRebuildMatchKind::Matched, None)
                        }
                        Some(_) => (
                            LibraryRootRebuildMatchKind::Changed,
                            Some("相对路径相同，但文件内容指纹已经变化".to_owned()),
                        ),
                        None => (
                            LibraryRootRebuildMatchKind::NeedsConfirmation,
                            Some("历史清单缺少文件指纹，请确认这是原视频".to_owned()),
                        ),
                    };
                    let rebuild = rebuild_item(item, Some(candidate), kind, reason)?;
                    match kind {
                        LibraryRootRebuildMatchKind::Matched => matched_items.push(rebuild),
                        LibraryRootRebuildMatchKind::Changed => changed_items.push(rebuild),
                        LibraryRootRebuildMatchKind::NeedsConfirmation => {
                            uncertain_items.push(rebuild)
                        }
                        LibraryRootRebuildMatchKind::Missing => unreachable!(),
                    }
                }
            }
        }
        let existing_fingerprints = repository
            .list_existing_fingerprints()?
            .into_iter()
            .map(|item| item.quick_fingerprint)
            .collect::<HashSet<_>>();
        let mut new_candidates = scanned
            .candidates
            .into_iter()
            .filter(|candidate| {
                !consumed_candidate_keys.contains(&relative_path_key(&candidate.relative_path))
            })
            .collect::<Vec<_>>();
        for candidate in &mut new_candidates {
            if existing_fingerprints.contains(&candidate.quick_fingerprint) {
                candidate.needs_confirmation = true;
                candidate.confirmation_reason =
                    Some("内容指纹与既有视频相同，但相对路径不同".to_owned());
            }
        }
        Ok(LibraryRootRebuildPreview {
            preview_token: String::new(),
            root_id: root_id.to_owned(),
            current_root_path: root.path,
            root_path: scanned.root_path,
            root_display_name: scanned.root_display_name.clone(),
            suggested_collection_title: scanned.suggested_collection_title,
            root_offline: false,
            new_candidates,
            matched_items,
            missing_items,
            changed_items,
            uncertain_items,
            ignored_count: scanned.ignored_count,
            expires_at_ms: 0,
        })
    }

    fn apply_rebuild_lease(
        &self,
        lease: &RecoveryLease,
        input: &ApplyLibraryRootRebuildInput,
    ) -> Result<LibraryRootRebuildResult, LibraryError> {
        let expected = lease.rebuild()?;
        if expected.preview_token != input.preview_token {
            return Err(LibraryError::Conflict(
                "剧集重建预览令牌与内存快照不一致".to_owned(),
            ));
        }
        if expected.root_offline {
            return Err(LibraryError::Conflict(
                "该文件夹当前不可用，请先选择位置并重新检查".to_owned(),
            ));
        }
        let mut current =
            self.build_rebuild_snapshot(&expected.root_id, Some(&expected.root_path))?;
        if !same_rebuild_snapshot(expected, &current) {
            return Err(LibraryError::Conflict(
                "文件夹内容在预览后发生变化，请重新检查".to_owned(),
            ));
        }
        align_rebuild_candidate_ids(expected, &mut current);
        if !current.missing_items.is_empty() && !input.confirm_missing {
            return Err(LibraryError::Conflict(
                "请确认保留缺失视频的字幕、进度和学习资料".to_owned(),
            ));
        }
        if !current.changed_items.is_empty() && !input.confirm_changed {
            return Err(LibraryError::Conflict(
                "请确认将内容变化的视频作为原项目重建".to_owned(),
            ));
        }
        if !current.uncertain_items.is_empty() && !input.confirm_uncertain_matches {
            return Err(LibraryError::Conflict(
                "请确认历史清单中无法自动确认的视频匹配".to_owned(),
            ));
        }
        let collection_title = validate_title(&input.collection_title)?;
        let synthetic_preview = LibraryScanPreview {
            scan_id: Uuid::new_v4().to_string(),
            preview_token: input.preview_token.clone(),
            root_path: current.root_path.clone(),
            root_display_name: current.root_display_name.clone(),
            suggested_collection_title: current.suggested_collection_title.clone(),
            candidates: current.new_candidates.clone(),
            ignored_entries: Vec::new(),
            ignored_count: current.ignored_count,
            needs_confirmation_count: current
                .new_candidates
                .iter()
                .filter(|candidate| candidate.needs_confirmation)
                .count() as u64,
            expires_at_ms: current.expires_at_ms,
        };
        let confirm_input = ConfirmLibraryImportInput {
            preview_token: input.preview_token.clone(),
            collection_title: collection_title.clone(),
            items: input.new_items.clone(),
            confirm_fingerprint_duplicates: input.confirm_fingerprint_duplicates,
        };
        let canonical_root = scanner::canonicalize_authorized_root(&current.root_path)?;
        let prepared = if current.new_candidates.is_empty() {
            if !input.new_items.is_empty() {
                return Err(LibraryError::Validation(
                    "重建预览没有可新增的视频".to_owned(),
                ));
            }
            Vec::new()
        } else {
            prepare_items(&synthetic_preview, &confirm_input, &canonical_root)?
        };
        let timestamp = now_ms()?;
        let mut connection = self.store.connect()?;
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let repository = LibraryRepository::new(&transaction);
        if repository.root_status(&current.root_id)? != super::LibraryRootStatus::Orphaned {
            return Err(LibraryError::Conflict(
                "该文件夹已经关联剧集，请刷新后再操作".to_owned(),
            ));
        }
        let existing_root = repository.get_root(&current.root_id)?;
        if existing_root.path_key != path_key(Path::new(&expected.current_root_path)) {
            return Err(LibraryError::Conflict(
                "原文件夹记录在预览后发生变化，请重新检查".to_owned(),
            ));
        }
        if repository
            .root_path_key_exists_elsewhere(&current.root_id, &path_key(&canonical_root))?
        {
            return Err(LibraryError::Conflict(
                "新的文件夹已经授权给其他媒体库".to_owned(),
            ));
        }
        let manifest = repository.list_root_manifest_items(&current.root_id)?;
        let expected_item_count = current.matched_items.len()
            + current.missing_items.len()
            + current.changed_items.len()
            + current.uncertain_items.len();
        if manifest.len() != expected_item_count {
            return Err(LibraryError::Conflict(
                "文件夹清单在预览后发生变化，请重新检查".to_owned(),
            ));
        }
        let candidates_by_key = scan_root(&current.root_path)?
            .candidates
            .into_iter()
            .map(|candidate| (relative_path_key(&candidate.relative_path), candidate))
            .collect::<HashMap<_, _>>();
        let existing_fingerprints = repository.list_existing_fingerprints()?;
        if !input.confirm_fingerprint_duplicates {
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
        let collection_id = Uuid::new_v4().to_string();
        let collection = super::Collection {
            id: collection_id.clone(),
            kind: super::CollectionKind::Series,
            title: collection_title,
            root_id: Some(current.root_id.clone()),
            system_key: None,
            poster_path: None,
            sort_mode: super::CollectionSortMode::Episode,
            auto_play_next: false,
            last_opened_at_ms: None,
            created_at_ms: timestamp,
            updated_at_ms: timestamp,
        };
        repository.insert_collection(&collection)?;
        repository.clear_root_manifest(&current.root_id)?;
        let mut restored_item_count = 0_u64;
        let mut missing_item_count = 0_u64;
        let changed_item_count = current.changed_items.len() as u64;
        for item in manifest {
            let relative_path = item.relative_path.as_deref().ok_or_else(|| {
                LibraryError::Conflict(format!(
                    "视频「{}」缺少相对路径，请先人工整理清单",
                    item.project_id
                ))
            })?;
            let relative_key = relative_path_key(relative_path);
            let candidate = candidates_by_key.get(&relative_key);
            let (availability, source_size, source_modified, fingerprint) = match candidate {
                Some(candidate) => {
                    let canonical_media = dunce::canonicalize(canonical_root.join(relative_path))?;
                    if !canonical_media.starts_with(&canonical_root) {
                        return Err(LibraryError::Validation(format!(
                            "视频逃出授权文件夹：{relative_path}"
                        )));
                    }
                    let display_name = canonical_media
                        .file_name()
                        .and_then(|value| value.to_str())
                        .ok_or_else(|| {
                            LibraryError::Validation(format!(
                                "视频文件名不是有效文本：{relative_path}"
                            ))
                        })?;
                    let size = i64::try_from(candidate.source_size_bytes).map_err(|_| {
                        LibraryError::Validation(format!(
                            "媒体文件大小超出支持范围：{relative_path}"
                        ))
                    })?;
                    repository.update_primary_media_source(
                        &item.project_id,
                        &canonical_media.to_string_lossy(),
                        display_name,
                        size,
                        candidate.source_modified_at_ms,
                        timestamp,
                    )?;
                    (
                        ItemAvailability::Available.as_database_value(),
                        Some(size),
                        candidate.source_modified_at_ms,
                        Some(candidate.quick_fingerprint.as_str()),
                    )
                }
                None => {
                    missing_item_count += 1;
                    (
                        ItemAvailability::Missing.as_database_value(),
                        item.source_size_bytes,
                        item.source_modified_at_ms,
                        item.quick_fingerprint.as_deref(),
                    )
                }
            };
            repository.insert_root_membership(&NewRootMembership {
                root_id: &current.root_id,
                collection_id: &collection_id,
                project_id: &item.project_id,
                season_number: item.season_number,
                episode_number: item.episode_number,
                absolute_order: item.absolute_order,
                display_title: &item.display_title,
                relative_path: Some(relative_path),
                relative_path_key: Some(&relative_key),
                availability,
                source_size_bytes: source_size,
                source_modified_at_ms: source_modified,
                quick_fingerprint: fingerprint,
                timestamp,
            })?;
            restored_item_count += 1;
        }

        let existing_locators = repository.list_primary_media_locators()?;
        let mut projects_by_path = existing_projects_by_path(existing_locators);
        let mut created_project_count = 0_u64;
        let mut reused_project_count = expected_item_count as u64;
        for item in &prepared {
            let project_id = if let Some(existing) = projects_by_path.get(&item.path_key) {
                validate_existing_locator(existing, item)?;
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
            let source_size_bytes = i64::try_from(item.file.source_size_bytes).map_err(|_| {
                LibraryError::Validation(format!(
                    "媒体文件大小超出支持范围：{}",
                    item.candidate.relative_path
                ))
            })?;
            let relative_key = relative_path_key(&item.candidate.relative_path);
            repository.insert_root_membership(&NewRootMembership {
                root_id: &current.root_id,
                collection_id: &collection_id,
                project_id: &project_id,
                season_number: item.input.season_number,
                episode_number: item.input.episode_number,
                absolute_order: item.input.absolute_order,
                display_title: &item.display_title,
                relative_path: Some(&item.candidate.relative_path),
                relative_path_key: Some(&relative_key),
                availability: ItemAvailability::Available.as_database_value(),
                source_size_bytes: Some(source_size_bytes),
                source_modified_at_ms: item.file.source_modified_at_ms,
                quick_fingerprint: Some(&item.candidate.quick_fingerprint),
                timestamp,
            })?;
        }
        repository.relocate_root(
            &current.root_id,
            &current.root_path,
            &path_key(&canonical_root),
            &current.root_display_name,
            timestamp,
        )?;
        let root = repository.get_root_summary(&current.root_id)?;
        let collection_detail = repository.get_collection_detail(&collection_id)?;
        migration::ensure_foreign_keys(&transaction)
            .map_err(StoreError::LibraryMigration)
            .map_err(LibraryError::Store)?;
        transaction.commit()?;
        Ok(LibraryRootRebuildResult {
            root,
            collection: collection_detail,
            restored_item_count,
            added_item_count: prepared.len() as u64,
            created_project_count,
            reused_project_count,
            missing_item_count,
            changed_item_count,
        })
    }

    fn backfill_legacy_root_manifest(
        &self,
        root_id: &str,
        root_path: &str,
    ) -> Result<(), LibraryError> {
        let timestamp = now_ms()?;
        let mut connection = self.store.connect()?;
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let repository = LibraryRepository::new(&transaction);
        if !repository.list_root_manifest_items(root_id)?.is_empty() {
            transaction.commit()?;
            return Ok(());
        }
        let root = PathBuf::from(root_path);
        let mut order = 0_i64;
        for locator in repository.list_primary_media_locators()? {
            let path = Path::new(&locator.locator);
            let Ok(relative) = path.strip_prefix(&root) else {
                continue;
            };
            let relative = relative.to_string_lossy().replace('\\', "/");
            if relative.is_empty() || !is_safe_relative_path(&relative) {
                continue;
            }
            let relative_key = relative_path_key(&relative);
            let availability = if path.is_file() {
                ItemAvailability::Available.as_database_value()
            } else {
                ItemAvailability::Missing.as_database_value()
            };
            repository.upsert_root_item(&NewRootItem {
                root_id,
                project_id: &locator.project_id,
                season_number: None,
                episode_number: None,
                absolute_order: order,
                display_title: &locator.display_name,
                relative_path: Some(&relative),
                relative_path_key: Some(&relative_key),
                availability,
                source_size_bytes: locator.source_size_bytes,
                source_modified_at_ms: locator.source_modified_at_ms,
                quick_fingerprint: None,
                timestamp,
            })?;
            order += 1;
        }
        migration::ensure_foreign_keys(&transaction)
            .map_err(StoreError::LibraryMigration)
            .map_err(LibraryError::Store)?;
        transaction.commit()?;
        Ok(())
    }

    fn apply_rescan_lease(
        &self,
        lease: &RecoveryLease,
        input: &ApplyLibraryRescanInput,
    ) -> Result<LibraryRescanResult, LibraryError> {
        let expected = lease.rescan()?;
        if expected.preview_token != input.preview_token {
            return Err(LibraryError::Conflict(
                "重新扫描预览令牌与内存快照不一致".to_owned(),
            ));
        }
        let mut current = self.build_rescan_snapshot(&expected.root_id)?;
        if !same_rescan_snapshot(expected, &current) {
            return Err(LibraryError::Conflict(
                "根目录内容在预览后发生变化，请重新扫描".to_owned(),
            ));
        }
        align_rescan_candidate_ids(expected, &mut current);
        if !current.missing_items.is_empty() && !input.confirm_missing {
            return Err(LibraryError::Conflict(
                "请确认保留缺失单集的字幕、进度和学习资料".to_owned(),
            ));
        }
        if !current.changed_items.is_empty() && !input.confirm_changed {
            return Err(LibraryError::Conflict(
                "请确认将同路径内容变化标记为已变更".to_owned(),
            ));
        }
        if current.root_offline && !input.confirm_missing {
            return Err(LibraryError::Conflict(
                "请确认将该根目录及全部单集标记为离线".to_owned(),
            ));
        }
        if current.root_offline && !input.new_items.is_empty() {
            return Err(LibraryError::Validation(
                "根目录离线时不能确认新增单集".to_owned(),
            ));
        }
        let timestamp = now_ms()?;
        if current.root_offline {
            let mut connection = self.store.connect()?;
            let transaction =
                connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
            let repository = LibraryRepository::new(&transaction);
            if repository.root_collection_id(&current.root_id)? != current.collection_id {
                return Err(LibraryError::Conflict(
                    "根目录的目标集合在预览后发生变化".to_owned(),
                ));
            }
            if repository.get_root(&current.root_id)?.path != current.root_path {
                return Err(LibraryError::Conflict(
                    "根目录位置在预览后发生变化".to_owned(),
                ));
            }
            repository.update_root_scan_state(&current.root_id, "offline", timestamp)?;
            repository.update_root_items_availability(
                &current.root_id,
                ItemAvailability::RootOffline,
                timestamp,
            )?;
            let result = recovery_result(
                &repository,
                &current,
                0,
                0,
                0,
                current.missing_items.len() as u64,
                current.changed_items.len() as u64,
            )?;
            migration::ensure_foreign_keys(&transaction)
                .map_err(StoreError::LibraryMigration)
                .map_err(LibraryError::Store)?;
            transaction.commit()?;
            return Ok(result);
        }

        let synthetic_preview = LibraryScanPreview {
            scan_id: Uuid::new_v4().to_string(),
            preview_token: input.preview_token.clone(),
            root_path: current.root_path.clone(),
            root_display_name: current.root_display_name.clone(),
            suggested_collection_title: current.root_display_name.clone(),
            candidates: current.new_candidates.clone(),
            ignored_entries: Vec::new(),
            ignored_count: current.ignored_count,
            needs_confirmation_count: current
                .new_candidates
                .iter()
                .filter(|candidate| candidate.needs_confirmation)
                .count() as u64,
            expires_at_ms: current.expires_at_ms,
        };
        let confirm_input = ConfirmLibraryImportInput {
            preview_token: input.preview_token.clone(),
            collection_title: current.root_display_name.clone(),
            items: input.new_items.clone(),
            confirm_fingerprint_duplicates: input.confirm_fingerprint_duplicates,
        };
        let canonical_root = scanner::canonicalize_authorized_root(&current.root_path)?;
        let prepared = if current.new_candidates.is_empty() {
            if !input.new_items.is_empty() {
                return Err(LibraryError::Validation(
                    "重新扫描预览没有新增单集".to_owned(),
                ));
            }
            Vec::new()
        } else {
            prepare_items(&synthetic_preview, &confirm_input, &canonical_root)?
        };

        let candidates_by_key = scan_root(&current.root_path)?
            .candidates
            .into_iter()
            .map(|candidate| (relative_path_key(&candidate.relative_path), candidate))
            .collect::<HashMap<_, _>>();
        let mut connection = self.store.connect()?;
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let repository = LibraryRepository::new(&transaction);
        let collection_id = repository.root_collection_id(&current.root_id)?;
        if collection_id != current.collection_id {
            return Err(LibraryError::Conflict(
                "根目录的目标集合在预览后发生变化".to_owned(),
            ));
        }
        let transactional_root = repository.get_root(&current.root_id)?;
        if transactional_root.path_key != path_key(Path::new(&current.root_path)) {
            return Err(LibraryError::Conflict(
                "根目录位置在预览后发生变化".to_owned(),
            ));
        }
        let root_items = repository.list_root_items(&current.root_id)?;
        let expected_existing_count = current.available_item_count
            + current.missing_items.len() as u64
            + current.changed_items.len() as u64;
        if root_items.len() as u64 != expected_existing_count {
            return Err(LibraryError::Conflict(
                "根目录成员在预览后发生变化".to_owned(),
            ));
        }
        for item in &root_items {
            let relative_key = item.relative_path_key.as_deref().ok_or_else(|| {
                LibraryError::InvalidData(format!("根目录成员缺少相对路径：{}", item.project_id))
            })?;
            let expected_fingerprint = item.quick_fingerprint.as_deref().ok_or_else(|| {
                LibraryError::InvalidData(format!("根目录成员缺少快速指纹：{}", item.project_id))
            })?;
            let (availability, size, modified) = match candidates_by_key.get(relative_key) {
                None => (ItemAvailability::Missing, None, None),
                Some(candidate) if candidate.quick_fingerprint != expected_fingerprint => {
                    (ItemAvailability::Changed, None, None)
                }
                Some(candidate) => (
                    ItemAvailability::Available,
                    Some(i64::try_from(candidate.source_size_bytes).map_err(|_| {
                        LibraryError::Validation(format!(
                            "媒体文件大小超出支持范围：{}",
                            candidate.relative_path
                        ))
                    })?),
                    candidate.source_modified_at_ms,
                ),
            };
            repository.update_membership_scan_state(
                &item.collection_id,
                &item.project_id,
                availability,
                size,
                modified,
                timestamp,
            )?;
        }

        let existing_locators = repository.list_primary_media_locators()?;
        let mut projects_by_path = existing_projects_by_path(existing_locators);
        if !input.confirm_fingerprint_duplicates {
            let fingerprints = repository.list_existing_fingerprints()?;
            for item in &prepared {
                if fingerprints.iter().any(|existing| {
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
        let mut added_item_count = 0_u64;
        let mut created_project_count = 0_u64;
        let mut reused_project_count = 0_u64;
        for item in &prepared {
            let project_id = if let Some(existing) = projects_by_path.get(&item.path_key) {
                validate_existing_locator(existing, item)?;
                if repository.membership_exists(&collection_id, &existing.project_id)? {
                    return Err(LibraryError::Conflict(format!(
                        "新增路径已经关联到当前集合的既有项目：{}",
                        item.candidate.relative_path
                    )));
                }
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
            added_item_count += 1;
        }
        repository.update_root_scan_state(&current.root_id, "available", timestamp)?;
        let result = recovery_result(
            &repository,
            &current,
            added_item_count,
            created_project_count,
            reused_project_count,
            current.missing_items.len() as u64,
            current.changed_items.len() as u64,
        )?;
        migration::ensure_foreign_keys(&transaction)
            .map_err(StoreError::LibraryMigration)
            .map_err(LibraryError::Store)?;
        transaction.commit()?;
        Ok(result)
    }

    fn build_relocation_snapshot(
        &self,
        root_id: &str,
        new_root_path: &str,
    ) -> Result<LibraryRootRelocationPreview, LibraryError> {
        let connection = self.store.connect()?;
        let repository = LibraryRepository::new(&connection);
        let root = repository.get_root(root_id)?;
        match repository.root_status(root_id)? {
            super::LibraryRootStatus::Linked => {}
            super::LibraryRootStatus::Orphaned => {
                return Err(LibraryError::Conflict(
                    "该文件夹当前没有关联剧集，不能执行「重新定位」。请使用「重建剧集」。"
                        .to_owned(),
                ));
            }
            super::LibraryRootStatus::Ambiguous => {
                return Err(LibraryError::Conflict(
                    "该文件夹关联多个剧集，暂不支持自动重新定位，请手动整理。".to_owned(),
                ));
            }
        }
        let canonical_new_root = scanner::canonicalize_authorized_root(new_root_path)?;
        let new_path_key = path_key(&canonical_new_root);
        if new_path_key == root.path_key {
            return Err(LibraryError::Validation(
                "新的根目录与当前根目录相同".to_owned(),
            ));
        }
        if repository.root_path_key_exists_elsewhere(root_id, &new_path_key)? {
            return Err(LibraryError::Conflict(
                "新的根目录已经授权给其他媒体库".to_owned(),
            ));
        }
        let items = repository.list_root_items(root_id)?;
        if items.iter().any(|item| item.shared_with_other_root) {
            return Err(LibraryError::Conflict(
                "根目录包含被其他授权根目录共享的项目，不能整体重定位".to_owned(),
            ));
        }
        let scanned = scan_root(&canonical_new_root.to_string_lossy())?;
        let candidates = scanned
            .candidates
            .into_iter()
            .map(|candidate| (relative_path_key(&candidate.relative_path), candidate))
            .collect::<HashMap<_, _>>();
        let mut mismatches = Vec::new();
        let mut matched_item_count = 0_u64;
        for item in &items {
            let (Some(relative_path), Some(relative_key), Some(expected_fingerprint)) = (
                item.relative_path.as_deref(),
                item.relative_path_key.as_deref(),
                item.quick_fingerprint.as_deref(),
            ) else {
                mismatches.push(LibraryRelocationMismatch {
                    project_id: item.project_id.clone(),
                    relative_path: item
                        .relative_path
                        .clone()
                        .unwrap_or_else(|| "（缺少相对路径）".to_owned()),
                    reason: RelocationMismatchReason::InvalidRelativePath,
                });
                continue;
            };
            if !is_safe_relative_path(relative_path) {
                mismatches.push(LibraryRelocationMismatch {
                    project_id: item.project_id.clone(),
                    relative_path: relative_path.to_owned(),
                    reason: RelocationMismatchReason::InvalidRelativePath,
                });
                continue;
            }
            match candidates.get(relative_key) {
                None => mismatches.push(LibraryRelocationMismatch {
                    project_id: item.project_id.clone(),
                    relative_path: relative_path.to_owned(),
                    reason: RelocationMismatchReason::Missing,
                }),
                Some(candidate) if candidate.quick_fingerprint != expected_fingerprint => {
                    mismatches.push(LibraryRelocationMismatch {
                        project_id: item.project_id.clone(),
                        relative_path: relative_path.to_owned(),
                        reason: RelocationMismatchReason::FingerprintChanged,
                    });
                }
                Some(_) => matched_item_count += 1,
            }
        }
        Ok(LibraryRootRelocationPreview {
            preview_token: String::new(),
            root_id: root_id.to_owned(),
            current_root_path: root.path,
            new_root_path: canonical_new_root.to_string_lossy().into_owned(),
            matched_item_count,
            mismatches,
            expires_at_ms: 0,
        })
    }

    fn apply_relocation_lease(
        &self,
        lease: &RecoveryLease,
    ) -> Result<LibraryRootRelocationResult, LibraryError> {
        let expected = lease.relocation()?;
        if !expected.mismatches.is_empty() {
            return Err(LibraryError::Conflict(
                "新根目录仍有缺失或内容不一致的文件，不能应用重定位".to_owned(),
            ));
        }
        let current = self.build_relocation_snapshot(&expected.root_id, &expected.new_root_path)?;
        if !same_relocation_snapshot(expected, &current) {
            return Err(LibraryError::Conflict(
                "新根目录内容在预览后发生变化，请重新检查".to_owned(),
            ));
        }
        let scanned = scan_root(&current.new_root_path)?;
        let candidates = scanned
            .candidates
            .into_iter()
            .map(|candidate| (relative_path_key(&candidate.relative_path), candidate))
            .collect::<HashMap<_, _>>();
        let canonical_new_root = PathBuf::from(&current.new_root_path);
        let timestamp = now_ms()?;
        let mut connection = self.store.connect()?;
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let repository = LibraryRepository::new(&transaction);
        if repository
            .root_path_key_exists_elsewhere(&current.root_id, &path_key(&canonical_new_root))?
        {
            return Err(LibraryError::Conflict(
                "新的根目录已经授权给其他媒体库".to_owned(),
            ));
        }
        let items = repository.list_root_items(&current.root_id)?;
        if items.iter().any(|item| item.shared_with_other_root) {
            return Err(LibraryError::Conflict(
                "根目录成员关系在预览后发生变化".to_owned(),
            ));
        }
        if items.len() as u64 != current.matched_item_count {
            return Err(LibraryError::Conflict(
                "根目录成员数量在预览后发生变化".to_owned(),
            ));
        }
        for item in &items {
            let relative_path = item.relative_path.as_deref().ok_or_else(|| {
                LibraryError::InvalidData(format!("根目录成员缺少相对路径：{}", item.project_id))
            })?;
            let relative_key = item.relative_path_key.as_deref().ok_or_else(|| {
                LibraryError::InvalidData(format!("根目录成员缺少相对路径键：{}", item.project_id))
            })?;
            let candidate = candidates.get(relative_key).ok_or_else(|| {
                LibraryError::Conflict(format!("新根目录缺少文件：{relative_path}"))
            })?;
            if item.quick_fingerprint.as_deref() != Some(candidate.quick_fingerprint.as_str()) {
                return Err(LibraryError::Conflict(format!(
                    "新根目录文件内容不一致：{relative_path}"
                )));
            }
            let canonical_media = dunce::canonicalize(canonical_new_root.join(relative_path))?;
            if !canonical_media.starts_with(&canonical_new_root) {
                return Err(LibraryError::Validation(format!(
                    "新根目录文件逃出授权范围：{relative_path}"
                )));
            }
            let display_name = canonical_media
                .file_name()
                .and_then(|value| value.to_str())
                .ok_or_else(|| {
                    LibraryError::Validation(format!("媒体文件名不是有效文本：{relative_path}"))
                })?;
            repository.relocate_membership_media(
                item,
                &canonical_media.to_string_lossy(),
                display_name,
                i64::try_from(candidate.source_size_bytes).map_err(|_| {
                    LibraryError::Validation(format!("媒体文件大小超出支持范围：{relative_path}"))
                })?,
                candidate.source_modified_at_ms,
                timestamp,
            )?;
        }
        let display_name = canonical_new_root
            .file_name()
            .and_then(|value| value.to_str())
            .filter(|value| !value.trim().is_empty())
            .unwrap_or("本地媒体");
        repository.relocate_root(
            &current.root_id,
            &current.new_root_path,
            &path_key(&canonical_new_root),
            display_name,
            timestamp,
        )?;
        let root = repository.get_root_summary(&current.root_id)?;
        migration::ensure_foreign_keys(&transaction)
            .map_err(StoreError::LibraryMigration)
            .map_err(LibraryError::Store)?;
        transaction.commit()?;
        Ok(LibraryRootRelocationResult {
            root,
            updated_item_count: items.len() as u64,
        })
    }
}

fn scan_root(root_path: &str) -> Result<scanner::ScannedLibraryFolder, LibraryError> {
    let cancelled = AtomicBool::new(false);
    scanner::scan_library_folder(&Uuid::new_v4().to_string(), root_path, &cancelled, |_| {})
}

fn is_safe_relative_path(value: &str) -> bool {
    let path = Path::new(value);
    !path.is_absolute()
        && !path.components().any(|component| {
            matches!(
                component,
                std::path::Component::ParentDir | std::path::Component::Prefix(_)
            )
        })
}

fn rebuild_item(
    item: &LibraryRootItemRecord,
    candidate: Option<&super::LibraryScanCandidate>,
    match_kind: LibraryRootRebuildMatchKind,
    reason: Option<String>,
) -> Result<LibraryRootRebuildItem, LibraryError> {
    Ok(LibraryRootRebuildItem {
        project_id: item.project_id.clone(),
        candidate_id: candidate.map(|value| value.candidate_id.clone()),
        relative_path: item
            .relative_path
            .clone()
            .unwrap_or_else(|| "（缺少相对路径）".to_owned()),
        display_title: item.display_title.clone(),
        season_number: item.season_number,
        episode_number: item.episode_number,
        absolute_order: item.absolute_order,
        previous_availability: ItemAvailability::from_database_value(&item.availability)?,
        match_kind,
        reason,
    })
}

fn same_rebuild_snapshot(
    expected: &LibraryRootRebuildPreview,
    current: &LibraryRootRebuildPreview,
) -> bool {
    let mut expected = expected.clone();
    let mut current = current.clone();
    expected.preview_token.clear();
    expected.expires_at_ms = 0;
    align_rebuild_candidate_ids(&expected, &mut current);
    expected == current
}

fn align_rebuild_candidate_ids(
    expected: &LibraryRootRebuildPreview,
    current: &mut LibraryRootRebuildPreview,
) {
    let candidates = expected
        .new_candidates
        .iter()
        .map(|candidate| {
            (
                relative_path_key(&candidate.relative_path),
                candidate.candidate_id.clone(),
            )
        })
        .collect::<HashMap<_, _>>();
    for candidate in &mut current.new_candidates {
        if let Some(candidate_id) = candidates.get(&relative_path_key(&candidate.relative_path)) {
            candidate.candidate_id.clone_from(candidate_id);
        }
    }
    align_rebuild_item_candidate_ids(&expected.matched_items, &mut current.matched_items);
    align_rebuild_item_candidate_ids(&expected.changed_items, &mut current.changed_items);
    align_rebuild_item_candidate_ids(&expected.uncertain_items, &mut current.uncertain_items);
}

fn align_rebuild_item_candidate_ids(
    expected: &[LibraryRootRebuildItem],
    current: &mut [LibraryRootRebuildItem],
) {
    let ids = expected
        .iter()
        .filter_map(|item| {
            item.candidate_id
                .as_ref()
                .map(|candidate_id| (relative_path_key(&item.relative_path), candidate_id.clone()))
        })
        .collect::<HashMap<_, _>>();
    for item in current {
        if let Some(candidate_id) = ids.get(&relative_path_key(&item.relative_path)) {
            item.candidate_id = Some(candidate_id.clone());
        }
    }
}

fn recovery_item(item: &RootMembershipRecord) -> Result<LibraryRecoveryItem, LibraryError> {
    Ok(LibraryRecoveryItem {
        collection_id: item.collection_id.clone(),
        project_id: item.project_id.clone(),
        relative_path: item.relative_path.clone().ok_or_else(|| {
            LibraryError::InvalidData(format!("根目录成员缺少相对路径：{}", item.project_id))
        })?,
        display_title: item.display_title.clone(),
        previous_availability: ItemAvailability::from_database_value(&item.availability)?,
    })
}

fn same_rescan_snapshot(expected: &LibraryRescanPreview, current: &LibraryRescanPreview) -> bool {
    let mut expected = expected.clone();
    let mut current = current.clone();
    expected.preview_token.clear();
    expected.expires_at_ms = 0;
    align_rescan_candidate_ids(&expected, &mut current);
    expected == current
}

fn align_rescan_candidate_ids(expected: &LibraryRescanPreview, current: &mut LibraryRescanPreview) {
    let ids = expected
        .new_candidates
        .iter()
        .map(|candidate| {
            (
                relative_path_key(&candidate.relative_path),
                candidate.candidate_id.clone(),
            )
        })
        .collect::<HashMap<_, _>>();
    for candidate in &mut current.new_candidates {
        if let Some(candidate_id) = ids.get(&relative_path_key(&candidate.relative_path)) {
            candidate.candidate_id.clone_from(candidate_id);
        }
    }
}

fn same_relocation_snapshot(
    expected: &LibraryRootRelocationPreview,
    current: &LibraryRootRelocationPreview,
) -> bool {
    let mut expected = expected.clone();
    expected.preview_token.clear();
    expected.expires_at_ms = 0;
    expected == *current
}

fn existing_projects_by_path(
    locators: Vec<ExistingMediaLocator>,
) -> HashMap<String, ExistingProjectAtPath> {
    locators
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
        .collect()
}

fn validate_existing_locator(
    existing: &ExistingProjectAtPath,
    item: &super::import_service::PreparedImportItem,
) -> Result<(), LibraryError> {
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
            "同路径的既有视频内容已经变化：{}",
            item.candidate.relative_path
        )));
    }
    Ok(())
}

fn recovery_result(
    repository: &LibraryRepository<'_>,
    preview: &LibraryRescanPreview,
    added_item_count: u64,
    created_project_count: u64,
    reused_project_count: u64,
    missing_item_count: u64,
    changed_item_count: u64,
) -> Result<LibraryRescanResult, LibraryError> {
    Ok(LibraryRescanResult {
        root: repository.get_root_summary(&preview.root_id)?,
        collection: repository.get_collection_detail(&preview.collection_id)?,
        added_item_count,
        created_project_count,
        reused_project_count,
        missing_item_count,
        changed_item_count,
        available_item_count: preview.available_item_count,
    })
}

#[cfg(test)]
mod tests {
    use std::fs;

    use tempfile::TempDir;

    use super::*;
    use crate::library::{
        ConfirmLibraryItemInput, InspectLibraryRootRebuildInput, LibraryImportService,
        LibraryPreviewStore, LibraryRootStatus, LibraryScanService, LibraryService,
        ScanLibraryFolderInput,
    };

    struct Fixture {
        temporary: TempDir,
        root: PathBuf,
        store: ProjectStore,
        recovery: LibraryRecoveryStore,
        root_id: String,
        collection_id: String,
    }

    impl Fixture {
        fn new() -> Self {
            let temporary = tempfile::tempdir().expect("temporary directory");
            let root = temporary.path().join("Rain");
            fs::create_dir_all(&root).expect("series root");
            fs::write(root.join("Rain.S01E01.mp4"), b"episode-one-original")
                .expect("first episode");
            fs::write(root.join("Rain.S01E02.mp4"), b"episode-two-original")
                .expect("second episode");
            let store = ProjectStore::open(temporary.path().join("data").join("siaovplay.db"))
                .expect("project store");
            let import_previews = LibraryPreviewStore::default();
            let scan_service = LibraryScanService::new(import_previews.clone());
            let scan_id = Uuid::new_v4().to_string();
            let cancelled = scan_service.begin_scan(&scan_id).expect("begin scan");
            let preview = scan_service
                .scan_started(
                    ScanLibraryFolderInput {
                        scan_id,
                        root_path: root.to_string_lossy().into_owned(),
                    },
                    cancelled,
                    |_| {},
                )
                .expect("scan preview");
            let items = preview
                .candidates
                .iter()
                .map(|candidate| ConfirmLibraryItemInput {
                    candidate_id: candidate.candidate_id.clone(),
                    display_title: candidate.display_title.clone(),
                    season_number: candidate.season_number,
                    episode_number: candidate.episode_number,
                    absolute_order: candidate.absolute_order,
                    confirmed: candidate.needs_confirmation,
                })
                .collect();
            let imported = LibraryImportService::new(store.clone(), import_previews)
                .confirm_import(ConfirmLibraryImportInput {
                    preview_token: preview.preview_token,
                    collection_title: "Rain".to_owned(),
                    items,
                    confirm_fingerprint_duplicates: false,
                })
                .expect("confirmed import");
            Self {
                temporary,
                root,
                store,
                recovery: LibraryRecoveryStore::default(),
                root_id: imported.root_id,
                collection_id: imported.collection.summary.collection.id,
            }
        }

        fn service(&self) -> LibraryRecoveryService {
            LibraryRecoveryService::new(self.store.clone(), self.recovery.clone())
        }

        fn status_by_path(&self) -> HashMap<String, String> {
            let connection = self.store.connect().expect("connection");
            let mut statement = connection
                .prepare(
                    "SELECT relative_path, availability
                     FROM collection_items WHERE collection_id = ?1",
                )
                .expect("status query");
            statement
                .query_map([&self.collection_id], |row| Ok((row.get(0)?, row.get(1)?)))
                .expect("status rows")
                .collect::<Result<HashMap<_, _>, _>>()
                .expect("status map")
        }
    }

    #[test]
    fn rescan_adds_new_and_marks_missing_or_changed_without_overwriting_sources() {
        let fixture = Fixture::new();
        fs::write(
            fixture.root.join("Rain.S01E01.mp4"),
            b"episode-one-replaced",
        )
        .expect("replace first episode");
        fs::remove_file(fixture.root.join("Rain.S01E02.mp4")).expect("remove second episode");
        fs::write(fixture.root.join("Rain.S01E03.mp4"), b"episode-three-new")
            .expect("add third episode");
        let source_before = fs::read(fixture.root.join("Rain.S01E01.mp4")).expect("source bytes");

        let service = fixture.service();
        let preview = service
            .inspect_rescan(&fixture.root_id)
            .expect("rescan preview");
        assert_eq!(preview.new_candidates.len(), 1);
        assert_eq!(preview.missing_items.len(), 1);
        assert_eq!(preview.changed_items.len(), 1);
        let new_items: Vec<ConfirmLibraryItemInput> = preview
            .new_candidates
            .iter()
            .map(|candidate| ConfirmLibraryItemInput {
                candidate_id: candidate.candidate_id.clone(),
                display_title: candidate.display_title.clone(),
                season_number: candidate.season_number,
                episode_number: candidate.episode_number,
                absolute_order: candidate.absolute_order,
                confirmed: candidate.needs_confirmation,
            })
            .collect();
        let token = preview.preview_token.clone();
        assert!(matches!(
            service.apply_rescan(ApplyLibraryRescanInput {
                preview_token: token.clone(),
                new_items: new_items.clone(),
                confirm_missing: false,
                confirm_changed: true,
                confirm_fingerprint_duplicates: false,
            }),
            Err(LibraryError::Conflict(_))
        ));
        let result = service
            .apply_rescan(ApplyLibraryRescanInput {
                preview_token: token.clone(),
                new_items,
                confirm_missing: true,
                confirm_changed: true,
                confirm_fingerprint_duplicates: false,
            })
            .expect("apply rescan");
        assert_eq!(result.added_item_count, 1);
        assert_eq!(result.created_project_count, 1);
        assert_eq!(result.reused_project_count, 0);
        assert_eq!(result.missing_item_count, 1);
        assert_eq!(result.changed_item_count, 1);
        assert_eq!(
            fs::read(fixture.root.join("Rain.S01E01.mp4")).expect("source after"),
            source_before
        );
        let statuses = fixture.status_by_path();
        assert_eq!(statuses["Rain.S01E01.mp4"], "changed");
        assert_eq!(statuses["Rain.S01E02.mp4"], "missing");
        assert_eq!(statuses["Rain.S01E03.mp4"], "available");
        assert!(matches!(
            service.apply_rescan(ApplyLibraryRescanInput {
                preview_token: token,
                new_items: Vec::new(),
                confirm_missing: true,
                confirm_changed: true,
                confirm_fingerprint_duplicates: false,
            }),
            Err(LibraryError::PreviewNotFound(_))
        ));
    }

    #[test]
    fn offline_rescan_marks_every_item_without_deleting_projects() {
        let fixture = Fixture::new();
        let moved = fixture.temporary.path().join("Rain-offline");
        fs::rename(&fixture.root, &moved).expect("move root offline");
        let service = fixture.service();
        let preview = service
            .inspect_rescan(&fixture.root_id)
            .expect("offline preview");
        assert!(preview.root_offline);
        let result = service
            .apply_rescan(ApplyLibraryRescanInput {
                preview_token: preview.preview_token,
                new_items: Vec::new(),
                confirm_missing: true,
                confirm_changed: false,
                confirm_fingerprint_duplicates: false,
            })
            .expect("apply offline state");
        assert_eq!(result.root.availability, "offline");
        assert!(
            fixture
                .status_by_path()
                .values()
                .all(|status| status == "root_offline")
        );
        let project_count: i64 = fixture
            .store
            .connect()
            .expect("connection")
            .query_row("SELECT COUNT(*) FROM projects", [], |row| row.get(0))
            .expect("project count");
        assert_eq!(project_count, 2);
    }

    #[test]
    fn relocation_preserves_project_revision_and_media_caches() {
        let fixture = Fixture::new();
        let new_root = fixture.temporary.path().join("Rain-relocated");
        fs::rename(&fixture.root, &new_root).expect("relocate directory");
        fixture
            .store
            .connect()
            .expect("connection")
            .execute(
                "UPDATE media_sources
                 SET source_sha256 = 'fixed-sha', probe_json = '{\"format\":\"test\"}',
                     probed_at_ms = 42, poster_path = 'poster.jpg'",
                [],
            )
            .expect("seed caches");
        let service = fixture.service();
        let preview = service
            .inspect_relocation(&fixture.root_id, &new_root.to_string_lossy())
            .expect("relocation preview");
        assert_eq!(preview.matched_item_count, 2);
        assert!(preview.mismatches.is_empty());
        let result = service
            .apply_relocation(ApplyLibraryRootRelocationInput {
                preview_token: preview.preview_token,
            })
            .expect("apply relocation");
        assert_eq!(result.updated_item_count, 2);
        assert_eq!(
            PathBuf::from(result.root.path),
            dunce::canonicalize(&new_root).unwrap()
        );
        let connection = fixture.store.connect().expect("connection");
        let preserved: (i64, String, String, i64, String) = connection
            .query_row(
                "SELECT p.revision, m.source_sha256, m.probe_json, m.probed_at_ms,
                        m.poster_path
                 FROM projects p
                 JOIN media_sources m ON m.project_id = p.id
                 LIMIT 1",
                [],
                |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                    ))
                },
            )
            .expect("preserved media metadata");
        assert_eq!(
            preserved,
            (
                1,
                "fixed-sha".to_owned(),
                "{\"format\":\"test\"}".to_owned(),
                42,
                "poster.jpg".to_owned()
            )
        );
        let locators = LibraryRepository::new(&connection)
            .list_primary_media_locators()
            .expect("locators");
        assert!(
            locators
                .iter()
                .all(|item| Path::new(&item.locator).starts_with(&new_root))
        );
    }

    #[test]
    fn relocation_rejects_same_relative_path_with_changed_content() {
        let fixture = Fixture::new();
        let new_root = fixture.temporary.path().join("Rain-copy");
        fs::create_dir_all(&new_root).expect("copy root");
        fs::copy(
            fixture.root.join("Rain.S01E01.mp4"),
            new_root.join("Rain.S01E01.mp4"),
        )
        .expect("copy first episode");
        fs::write(
            new_root.join("Rain.S01E02.mp4"),
            b"different-second-episode",
        )
        .expect("changed second episode");
        let service = fixture.service();
        let preview = service
            .inspect_relocation(&fixture.root_id, &new_root.to_string_lossy())
            .expect("relocation preview");
        assert_eq!(preview.matched_item_count, 1);
        assert_eq!(preview.mismatches.len(), 1);
        assert_eq!(
            preview.mismatches[0].reason,
            RelocationMismatchReason::FingerprintChanged
        );
        assert!(matches!(
            service.apply_relocation(ApplyLibraryRootRelocationInput {
                preview_token: preview.preview_token,
            }),
            Err(LibraryError::Conflict(_))
        ));
    }

    #[test]
    fn rebuild_after_collection_deletion_reuses_projects_and_preserves_playback() {
        let fixture = Fixture::new();
        let project_ids = fixture
            .store
            .connect()
            .expect("connection")
            .prepare("SELECT project_id FROM collection_items WHERE collection_id = ?1 ORDER BY project_id")
            .expect("project query")
            .query_map([&fixture.collection_id], |row| row.get::<_, String>(0))
            .expect("project rows")
            .collect::<Result<Vec<_>, _>>()
            .expect("project ids");
        fixture
            .store
            .connect()
            .expect("connection")
            .execute(
                "UPDATE playback_states SET position_ms = 1234 WHERE project_id = ?1",
                [&project_ids[0]],
            )
            .expect("playback state");
        LibraryService::new(fixture.store.clone())
            .delete_collection(&fixture.collection_id)
            .expect("delete collection");

        let service = fixture.service();
        let preview = service
            .inspect_rebuild(InspectLibraryRootRebuildInput {
                root_id: fixture.root_id.clone(),
                new_root_path: None,
            })
            .expect("rebuild preview");
        assert_eq!(preview.matched_items.len(), 2);
        assert!(preview.missing_items.is_empty());
        let result = service
            .apply_rebuild(ApplyLibraryRootRebuildInput {
                preview_token: preview.preview_token,
                collection_title: "Rain 重建".to_owned(),
                new_items: Vec::new(),
                confirm_missing: false,
                confirm_changed: false,
                confirm_uncertain_matches: false,
                confirm_fingerprint_duplicates: false,
            })
            .expect("apply rebuild");
        assert_eq!(result.restored_item_count, 2);
        assert_eq!(result.created_project_count, 0);
        assert_eq!(result.reused_project_count, 2);
        assert_eq!(result.root.status, LibraryRootStatus::Linked);
        assert_ne!(
            result.collection.summary.collection.id,
            fixture.collection_id
        );

        let connection = fixture.store.connect().expect("connection");
        let rebuilt_ids = connection
            .prepare(
                "SELECT project_id FROM collection_items WHERE collection_id = ?1 ORDER BY project_id",
            )
            .expect("rebuilt project query")
            .query_map([&result.collection.summary.collection.id], |row| {
                row.get::<_, String>(0)
            })
            .expect("rebuilt project rows")
            .collect::<Result<Vec<_>, _>>()
            .expect("rebuilt project ids");
        assert_eq!(rebuilt_ids, project_ids);
        let position: i64 = connection
            .query_row(
                "SELECT position_ms FROM playback_states WHERE project_id = ?1",
                [&project_ids[0]],
                |row| row.get(0),
            )
            .expect("playback position");
        assert_eq!(position, 1234);
    }

    #[test]
    fn rebuild_after_moving_orphaned_root_reuses_project_sources() {
        let fixture = Fixture::new();
        let project_ids = fixture
            .store
            .connect()
            .expect("connection")
            .prepare("SELECT project_id FROM collection_items WHERE collection_id = ?1 ORDER BY project_id")
            .expect("project query")
            .query_map([&fixture.collection_id], |row| row.get::<_, String>(0))
            .expect("project rows")
            .collect::<Result<Vec<_>, _>>()
            .expect("project ids");
        LibraryService::new(fixture.store.clone())
            .delete_collection(&fixture.collection_id)
            .expect("delete collection");
        let new_root = fixture.temporary.path().join("Rain-moved");
        fs::rename(&fixture.root, &new_root).expect("move root");

        let service = fixture.service();
        let preview = service
            .inspect_rebuild(InspectLibraryRootRebuildInput {
                root_id: fixture.root_id.clone(),
                new_root_path: Some(new_root.to_string_lossy().into_owned()),
            })
            .expect("rebuild preview");
        assert_eq!(preview.matched_items.len(), 2);
        let result = service
            .apply_rebuild(ApplyLibraryRootRebuildInput {
                preview_token: preview.preview_token,
                collection_title: "Rain moved".to_owned(),
                new_items: Vec::new(),
                confirm_missing: false,
                confirm_changed: false,
                confirm_uncertain_matches: false,
                confirm_fingerprint_duplicates: false,
            })
            .expect("apply moved rebuild");
        assert_eq!(result.created_project_count, 0);
        assert_eq!(result.reused_project_count, 2);
        let connection = fixture.store.connect().expect("connection");
        let rebuilt_ids = connection
            .prepare(
                "SELECT project_id FROM collection_items WHERE collection_id = ?1 ORDER BY project_id",
            )
            .expect("rebuilt project query")
            .query_map([&result.collection.summary.collection.id], |row| {
                row.get::<_, String>(0)
            })
            .expect("rebuilt project rows")
            .collect::<Result<Vec<_>, _>>()
            .expect("rebuilt project ids");
        assert_eq!(rebuilt_ids, project_ids);
        let locators = LibraryRepository::new(&connection)
            .list_primary_media_locators()
            .expect("locators");
        assert!(
            locators
                .iter()
                .all(|item| Path::new(&item.locator).starts_with(&new_root))
        );
    }

    #[test]
    fn changed_rebuild_item_requires_explicit_confirmation() {
        let fixture = Fixture::new();
        fs::write(fixture.root.join("Rain.S01E01.mp4"), b"episode-one-changed")
            .expect("change episode");
        LibraryService::new(fixture.store.clone())
            .delete_collection(&fixture.collection_id)
            .expect("delete collection");
        let service = fixture.service();
        let preview = service
            .inspect_rebuild(InspectLibraryRootRebuildInput {
                root_id: fixture.root_id.clone(),
                new_root_path: None,
            })
            .expect("rebuild preview");
        assert_eq!(preview.changed_items.len(), 1);
        let token = preview.preview_token.clone();
        assert!(matches!(
            service.apply_rebuild(ApplyLibraryRootRebuildInput {
                preview_token: token.clone(),
                collection_title: "Rain changed".to_owned(),
                new_items: Vec::new(),
                confirm_missing: false,
                confirm_changed: false,
                confirm_uncertain_matches: false,
                confirm_fingerprint_duplicates: false,
            }),
            Err(LibraryError::Conflict(_))
        ));
        let result = service
            .apply_rebuild(ApplyLibraryRootRebuildInput {
                preview_token: token,
                collection_title: "Rain changed".to_owned(),
                new_items: Vec::new(),
                confirm_missing: false,
                confirm_changed: true,
                confirm_uncertain_matches: false,
                confirm_fingerprint_duplicates: false,
            })
            .expect("confirmed changed rebuild");
        assert_eq!(result.changed_item_count, 1);
    }
}
