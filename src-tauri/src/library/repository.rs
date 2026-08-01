use std::path::Path;

use rusqlite::{Connection, OptionalExtension, Row, params};

use super::{
    Collection, CollectionDetail, CollectionKind, CollectionSortMode, CollectionSummary,
    EpisodeReference, ItemAvailability, LibraryError, LibraryRootSummary, MediaSummary,
    SearchResult, SearchResultKind, SeasonSummary,
};

pub(crate) struct LibraryRepository<'connection> {
    connection: &'connection Connection,
}

impl<'connection> LibraryRepository<'connection> {
    pub(crate) fn new(connection: &'connection Connection) -> Self {
        Self { connection }
    }

    pub(crate) fn insert_collection(&self, collection: &Collection) -> Result<(), LibraryError> {
        self.connection.execute(
            "INSERT INTO collections (
                id, kind, title, root_id, system_key, poster_path, sort_mode,
                auto_play_next, last_opened_at_ms, created_at_ms, updated_at_ms
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            params![
                collection.id,
                collection.kind.as_database_value(),
                collection.title,
                collection.root_id,
                collection.system_key,
                collection.poster_path,
                collection.sort_mode.as_database_value(),
                i64::from(collection.auto_play_next),
                collection.last_opened_at_ms,
                collection.created_at_ms,
                collection.updated_at_ms,
            ],
        )?;
        Ok(())
    }

    pub(crate) fn insert_library_root(
        &self,
        root: &NewLibraryRoot<'_>,
    ) -> Result<(), LibraryError> {
        self.connection.execute(
            "INSERT INTO library_roots (
                id, path, path_key, display_name, scan_policy, availability,
                last_scanned_at_ms, created_at_ms, updated_at_ms
             ) VALUES (?1, ?2, ?3, ?4, 'manual', 'available', ?5, ?5, ?5)",
            params![
                root.id,
                root.path,
                root.path_key,
                root.display_name,
                root.timestamp,
            ],
        )?;
        Ok(())
    }

    pub(crate) fn root_exists_by_path_key(&self, path_key: &str) -> Result<bool, LibraryError> {
        self.connection
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM library_roots WHERE path_key = ?1)",
                params![path_key],
                |row| row.get(0),
            )
            .map_err(Into::into)
    }

    pub(crate) fn list_primary_media_locators(
        &self,
    ) -> Result<Vec<ExistingMediaLocator>, LibraryError> {
        let mut statement = self.connection.prepare(
            "SELECT project_id, locator, source_size_bytes, source_modified_at_ms
             FROM media_sources
             WHERE kind = 'local_file' AND is_primary = 1
             ORDER BY project_id",
        )?;
        statement
            .query_map([], |row| {
                Ok(ExistingMediaLocator {
                    project_id: row.get(0)?,
                    locator: row.get(1)?,
                    source_size_bytes: row.get(2)?,
                    source_modified_at_ms: row.get(3)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()
            .map_err(Into::into)
    }

    pub(crate) fn list_existing_fingerprints(
        &self,
    ) -> Result<Vec<ExistingFingerprint>, LibraryError> {
        let mut statement = self.connection.prepare(
            "SELECT ci.quick_fingerprint, m.locator
             FROM collection_items ci
             JOIN media_sources m ON m.project_id = ci.project_id AND m.is_primary = 1
             WHERE ci.quick_fingerprint IS NOT NULL
             ORDER BY ci.quick_fingerprint, m.locator",
        )?;
        statement
            .query_map([], |row| {
                Ok(ExistingFingerprint {
                    quick_fingerprint: row.get(0)?,
                    locator: row.get(1)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()
            .map_err(Into::into)
    }

    pub(crate) fn insert_imported_project(
        &self,
        project: &NewImportedProject<'_>,
    ) -> Result<(), LibraryError> {
        self.connection.execute(
            "INSERT INTO projects (
                id, title, revision, created_at_ms, updated_at_ms, last_opened_at_ms
             ) VALUES (?1, ?2, 1, ?3, ?3, ?3)",
            params![project.project_id, project.title, project.timestamp],
        )?;
        self.connection.execute(
            "INSERT INTO media_sources (
                id, project_id, kind, locator, display_name, is_primary,
                source_size_bytes, source_modified_at_ms, created_at_ms, updated_at_ms
             ) VALUES (?1, ?2, 'local_file', ?3, ?4, 1, ?5, ?6, ?7, ?7)",
            params![
                project.media_source_id,
                project.project_id,
                project.locator,
                project.display_name,
                project.source_size_bytes,
                project.source_modified_at_ms,
                project.timestamp,
            ],
        )?;
        self.connection.execute(
            "INSERT INTO playback_states (
                project_id, position_ms, duration_ms, volume, playback_rate,
                subtitle_mode, updated_at_ms, completed_at_ms
             ) VALUES (?1, 0, NULL, 1.0, 1.0, 'translation', ?2, NULL)",
            params![project.project_id, project.timestamp],
        )?;
        Ok(())
    }

    pub(crate) fn insert_imported_membership(
        &self,
        membership: &NewImportedMembership<'_>,
    ) -> Result<(), LibraryError> {
        self.connection.execute(
            "INSERT INTO collection_items (
                collection_id, project_id, season_number, episode_number,
                absolute_order, display_title, relative_path, relative_path_key,
                availability, source_size_bytes, source_modified_at_ms,
                quick_fingerprint, created_at_ms, updated_at_ms
             ) VALUES (
                ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8,
                'available', ?9, ?10, ?11, ?12, ?12
             )",
            params![
                membership.collection_id,
                membership.project_id,
                membership.season_number,
                membership.episode_number,
                membership.absolute_order,
                membership.display_title,
                membership.relative_path,
                membership.relative_path_key,
                membership.source_size_bytes,
                membership.source_modified_at_ms,
                membership.quick_fingerprint,
                membership.timestamp,
            ],
        )?;
        Ok(())
    }

    pub(crate) fn update_collection(&self, collection: &Collection) -> Result<(), LibraryError> {
        let changed = self.connection.execute(
            "UPDATE collections
             SET title = ?2,
                 sort_mode = ?3,
                 auto_play_next = ?4,
                 last_opened_at_ms = ?5,
                 updated_at_ms = ?6
             WHERE id = ?1",
            params![
                collection.id,
                collection.title,
                collection.sort_mode.as_database_value(),
                i64::from(collection.auto_play_next),
                collection.last_opened_at_ms,
                collection.updated_at_ms,
            ],
        )?;
        if changed == 0 {
            return Err(LibraryError::CollectionNotFound(collection.id.clone()));
        }
        Ok(())
    }

    pub(crate) fn delete_collection(&self, collection_id: &str) -> Result<(), LibraryError> {
        let changed = self.connection.execute(
            "DELETE FROM collections WHERE id = ?1",
            params![collection_id],
        )?;
        if changed == 0 {
            return Err(LibraryError::CollectionNotFound(collection_id.to_owned()));
        }
        Ok(())
    }

    pub(crate) fn get_collection(&self, collection_id: &str) -> Result<Collection, LibraryError> {
        self.connection
            .query_row(
                "SELECT
                    id, kind, title, root_id, system_key, poster_path, sort_mode,
                    auto_play_next, last_opened_at_ms, created_at_ms, updated_at_ms
                 FROM collections
                 WHERE id = ?1",
                params![collection_id],
                map_collection,
            )
            .optional()?
            .ok_or_else(|| LibraryError::CollectionNotFound(collection_id.to_owned()))
    }

    pub(crate) fn get_system_collection(
        &self,
        system_key: &str,
    ) -> Result<Option<Collection>, LibraryError> {
        self.connection
            .query_row(
                "SELECT
                    id, kind, title, root_id, system_key, poster_path, sort_mode,
                    auto_play_next, last_opened_at_ms, created_at_ms, updated_at_ms
                 FROM collections
                 WHERE system_key = ?1",
                params![system_key],
                map_collection,
            )
            .optional()
            .map_err(Into::into)
    }

    pub(crate) fn list_collection_summaries(&self) -> Result<Vec<CollectionSummary>, LibraryError> {
        let mut statement = self.connection.prepare(
            "SELECT
                c.id, c.kind, c.title, c.root_id, c.system_key, c.poster_path,
                c.sort_mode, c.auto_play_next, c.last_opened_at_ms,
                c.created_at_ms, c.updated_at_ms,
                COUNT(ci.project_id) AS item_count,
                COUNT(DISTINCT ci.season_number) AS season_count,
                COALESCE(SUM(CASE WHEN ps.completed_at_ms IS NOT NULL THEN 1 ELSE 0 END), 0)
                    AS watched_count,
                SUM(ps.duration_ms) AS total_duration_ms
             FROM collections c
             LEFT JOIN collection_items ci ON ci.collection_id = c.id
             LEFT JOIN playback_states ps ON ps.project_id = ci.project_id
             GROUP BY c.id
             ORDER BY
                CASE WHEN c.system_key = 'watch_later' THEN 1 ELSE 0 END,
                COALESCE(c.last_opened_at_ms, 0) DESC,
                c.updated_at_ms DESC,
                c.title COLLATE NOCASE,
                c.id",
        )?;
        statement
            .query_and_then([], map_collection_summary)?
            .collect()
    }

    pub(crate) fn get_collection_detail(
        &self,
        collection_id: &str,
    ) -> Result<CollectionDetail, LibraryError> {
        let summary = self
            .connection
            .query_row(
                "SELECT
                    c.id, c.kind, c.title, c.root_id, c.system_key, c.poster_path,
                    c.sort_mode, c.auto_play_next, c.last_opened_at_ms,
                    c.created_at_ms, c.updated_at_ms,
                    COUNT(ci.project_id) AS item_count,
                    COUNT(DISTINCT ci.season_number) AS season_count,
                    COALESCE(SUM(CASE WHEN ps.completed_at_ms IS NOT NULL THEN 1 ELSE 0 END), 0)
                        AS watched_count,
                    SUM(ps.duration_ms) AS total_duration_ms
                 FROM collections c
                 LEFT JOIN collection_items ci ON ci.collection_id = c.id
                 LEFT JOIN playback_states ps ON ps.project_id = ci.project_id
                 WHERE c.id = ?1
                 GROUP BY c.id",
                params![collection_id],
                |row| map_collection_summary(row).map_err(as_sql_error),
            )
            .optional()?
            .ok_or_else(|| LibraryError::CollectionNotFound(collection_id.to_owned()))?;

        let mut statement = self.connection.prepare(
            "SELECT
                ci.season_number,
                COUNT(*) AS episode_count,
                SUM(CASE WHEN ps.completed_at_ms IS NOT NULL THEN 1 ELSE 0 END)
                    AS watched_count,
                SUM(ps.duration_ms) AS total_duration_ms
             FROM collection_items ci
             JOIN playback_states ps ON ps.project_id = ci.project_id
             WHERE ci.collection_id = ?1
             GROUP BY ci.season_number
             ORDER BY ci.season_number IS NULL, ci.season_number",
        )?;
        let seasons = statement
            .query_map(params![collection_id], |row| {
                Ok(SeasonSummary {
                    season_number: row.get(0)?,
                    episode_count: row.get(1)?,
                    watched_count: row.get(2)?,
                    total_duration_ms: row.get(3)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(CollectionDetail { summary, seasons })
    }

    pub(crate) fn list_roots(&self) -> Result<Vec<LibraryRootSummary>, LibraryError> {
        let mut statement = self.connection.prepare(
            "SELECT
                lr.id, lr.path, lr.display_name, lr.availability,
                lr.last_scanned_at_ms, COUNT(DISTINCT ci.project_id)
             FROM library_roots lr
             LEFT JOIN collections c ON c.root_id = lr.id
             LEFT JOIN collection_items ci ON ci.collection_id = c.id
             GROUP BY lr.id
             ORDER BY lr.display_name COLLATE NOCASE, lr.id",
        )?;
        statement
            .query_map([], |row| {
                Ok(LibraryRootSummary {
                    id: row.get(0)?,
                    path: row.get(1)?,
                    display_name: row.get(2)?,
                    availability: row.get(3)?,
                    last_scanned_at_ms: row.get(4)?,
                    item_count: row.get(5)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()
            .map_err(Into::into)
    }

    pub(crate) fn list_continue_watching(
        &self,
        limit: i64,
    ) -> Result<Vec<MediaSummary>, LibraryError> {
        let mut statement = self.connection.prepare(
            "SELECT
                p.id, p.title, m.display_name, m.locator, m.poster_path,
                ps.position_ms, ps.duration_ms, ps.completed_at_ms,
                p.last_opened_at_ms, p.created_at_ms,
                EXISTS(
                    SELECT 1 FROM subtitle_tracks st
                    WHERE st.project_id = p.id AND st.role = 'original'
                      AND st.current_version_id IS NOT NULL
                ),
                EXISTS(
                    SELECT 1 FROM subtitle_tracks st
                    WHERE st.project_id = p.id AND st.role = 'translation'
                      AND st.language_code = 'zh-cn' AND st.current_version_id IS NOT NULL
                ),
                MIN(ci.collection_id), MIN(c.title), MIN(ci.season_number),
                MIN(ci.episode_number), MIN(ci.absolute_order), MIN(ci.display_title),
                MIN(ci.availability)
             FROM projects p
             JOIN media_sources m ON m.project_id = p.id AND m.is_primary = 1
             JOIN playback_states ps ON ps.project_id = p.id
             LEFT JOIN collection_items ci ON ci.project_id = p.id
             LEFT JOIN collections c ON c.id = ci.collection_id
             WHERE ps.position_ms > 0 AND ps.completed_at_ms IS NULL
             GROUP BY p.id
             ORDER BY p.last_opened_at_ms DESC, p.updated_at_ms DESC, p.id
             LIMIT ?1",
        )?;
        statement
            .query_and_then(params![limit], map_media_summary)?
            .collect()
    }

    pub(crate) fn list_unclassified(&self, limit: i64) -> Result<Vec<MediaSummary>, LibraryError> {
        let mut statement = self.connection.prepare(
            "SELECT
                p.id, p.title, m.display_name, m.locator, m.poster_path,
                ps.position_ms, ps.duration_ms, ps.completed_at_ms,
                p.last_opened_at_ms, p.created_at_ms,
                EXISTS(
                    SELECT 1 FROM subtitle_tracks st
                    WHERE st.project_id = p.id AND st.role = 'original'
                      AND st.current_version_id IS NOT NULL
                ),
                EXISTS(
                    SELECT 1 FROM subtitle_tracks st
                    WHERE st.project_id = p.id AND st.role = 'translation'
                      AND st.language_code = 'zh-cn' AND st.current_version_id IS NOT NULL
                ),
                NULL, NULL, NULL, NULL, NULL, NULL, NULL
             FROM projects p
             JOIN media_sources m ON m.project_id = p.id AND m.is_primary = 1
             JOIN playback_states ps ON ps.project_id = p.id
             WHERE NOT EXISTS (
                SELECT 1 FROM collection_items ci WHERE ci.project_id = p.id
             )
             ORDER BY p.created_at_ms DESC, p.id
             LIMIT ?1",
        )?;
        statement
            .query_and_then(params![limit], map_media_summary)?
            .collect()
    }

    pub(crate) fn list_collection_episodes(
        &self,
        collection_id: &str,
        season_number: Option<i64>,
    ) -> Result<Vec<MediaSummary>, LibraryError> {
        self.get_collection(collection_id)?;
        let mut statement = self.connection.prepare(
            "SELECT
                p.id, p.title, m.display_name, m.locator, m.poster_path,
                ps.position_ms, ps.duration_ms, ps.completed_at_ms,
                p.last_opened_at_ms, p.created_at_ms,
                EXISTS(
                    SELECT 1 FROM subtitle_tracks st
                    WHERE st.project_id = p.id AND st.role = 'original'
                      AND st.current_version_id IS NOT NULL
                ),
                EXISTS(
                    SELECT 1 FROM subtitle_tracks st
                    WHERE st.project_id = p.id AND st.role = 'translation'
                      AND st.language_code = 'zh-cn' AND st.current_version_id IS NOT NULL
                ),
                c.id, c.title, ci.season_number, ci.episode_number,
                ci.absolute_order, ci.display_title, ci.availability
             FROM collection_items ci
             JOIN collections c ON c.id = ci.collection_id
             JOIN projects p ON p.id = ci.project_id
             JOIN media_sources m ON m.project_id = p.id AND m.is_primary = 1
             JOIN playback_states ps ON ps.project_id = p.id
             WHERE ci.collection_id = ?1
               AND (?2 IS NULL OR ci.season_number = ?2)
             ORDER BY
                CASE WHEN c.sort_mode = 'manual' THEN ci.absolute_order END,
                CASE WHEN c.sort_mode != 'manual' THEN ci.season_number END,
                CASE WHEN c.sort_mode != 'manual' THEN ci.episode_number END,
                ci.absolute_order,
                ci.display_title COLLATE NOCASE,
                ci.project_id",
        )?;
        statement
            .query_and_then(params![collection_id, season_number], map_media_summary)?
            .collect()
    }

    pub(crate) fn list_episode_references(
        &self,
        collection_id: &str,
    ) -> Result<Vec<EpisodeReference>, LibraryError> {
        let mut statement = self.connection.prepare(
            "SELECT
                ci.project_id, ci.display_title, ci.season_number,
                ci.episode_number, ci.absolute_order
             FROM collection_items ci
             JOIN collections c ON c.id = ci.collection_id
             WHERE ci.collection_id = ?1
             ORDER BY
                CASE WHEN c.sort_mode = 'manual' THEN ci.absolute_order END,
                CASE WHEN c.sort_mode != 'manual' THEN ci.season_number END,
                CASE WHEN c.sort_mode != 'manual' THEN ci.episode_number END,
                ci.absolute_order,
                ci.display_title COLLATE NOCASE,
                ci.project_id",
        )?;
        statement
            .query_map(params![collection_id], |row| {
                Ok(EpisodeReference {
                    project_id: row.get(0)?,
                    display_title: row.get(1)?,
                    season_number: row.get(2)?,
                    episode_number: row.get(3)?,
                    absolute_order: row.get(4)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()
            .map_err(Into::into)
    }

    pub(crate) fn search(
        &self,
        pattern: &str,
        limit: i64,
    ) -> Result<Vec<SearchResult>, LibraryError> {
        let mut statement = self.connection.prepare(
            "SELECT
                'collection' AS result_kind,
                c.title,
                CASE c.kind
                    WHEN 'series' THEN '剧集'
                    WHEN 'folder' THEN '文件夹'
                    ELSE '合集'
                END AS subtitle,
                c.id AS collection_id,
                NULL AS project_id,
                NULL AS season_number,
                NULL AS episode_number
             FROM collections c
             WHERE c.title LIKE ?1 ESCAPE '\\' COLLATE NOCASE

             UNION ALL

             SELECT
                CASE WHEN MIN(ci.collection_id) IS NULL
                    THEN 'unclassified' ELSE 'episode' END AS result_kind,
                p.title,
                CASE WHEN MIN(c.title) IS NULL
                    THEN m.display_name ELSE MIN(c.title) END AS subtitle,
                MIN(ci.collection_id) AS collection_id,
                p.id AS project_id,
                MIN(ci.season_number) AS season_number,
                MIN(ci.episode_number) AS episode_number
             FROM projects p
             JOIN media_sources m ON m.project_id = p.id AND m.is_primary = 1
             LEFT JOIN collection_items ci ON ci.project_id = p.id
             LEFT JOIN collections c ON c.id = ci.collection_id
             WHERE p.title LIKE ?1 ESCAPE '\\' COLLATE NOCASE
                OR m.display_name LIKE ?1 ESCAPE '\\' COLLATE NOCASE
                OR ci.display_title LIKE ?1 ESCAPE '\\' COLLATE NOCASE
             GROUP BY p.id

             ORDER BY title COLLATE NOCASE, result_kind, project_id
             LIMIT ?2",
        )?;
        statement
            .query_and_then(params![pattern, limit], |row| {
                let kind = row.get::<_, String>(0)?;
                Ok(SearchResult {
                    kind: SearchResultKind::from_database_value(&kind)?,
                    title: row.get(1)?,
                    subtitle: row.get(2)?,
                    collection_id: row.get(3)?,
                    project_id: row.get(4)?,
                    season_number: row.get(5)?,
                    episode_number: row.get(6)?,
                })
            })?
            .collect()
    }

    pub(crate) fn project_title(&self, project_id: &str) -> Result<String, LibraryError> {
        self.connection
            .query_row(
                "SELECT title FROM projects WHERE id = ?1",
                params![project_id],
                |row| row.get(0),
            )
            .optional()?
            .ok_or_else(|| {
                LibraryError::Store(crate::store::StoreError::ProjectNotFound(
                    project_id.to_owned(),
                ))
            })
    }

    pub(crate) fn membership_exists(
        &self,
        collection_id: &str,
        project_id: &str,
    ) -> Result<bool, LibraryError> {
        self.connection
            .query_row(
                "SELECT EXISTS(
                    SELECT 1 FROM collection_items
                    WHERE collection_id = ?1 AND project_id = ?2
                 )",
                params![collection_id, project_id],
                |row| row.get(0),
            )
            .map_err(Into::into)
    }

    pub(crate) fn next_absolute_order(&self, collection_id: &str) -> Result<i64, LibraryError> {
        self.connection
            .query_row(
                "SELECT COALESCE(MAX(absolute_order), -1) + 1
                 FROM collection_items WHERE collection_id = ?1",
                params![collection_id],
                |row| row.get(0),
            )
            .map_err(Into::into)
    }

    pub(crate) fn insert_membership(
        &self,
        membership: &NewMembership<'_>,
        timestamp: i64,
    ) -> Result<(), LibraryError> {
        self.connection.execute(
            "INSERT INTO collection_items (
                collection_id, project_id, season_number, episode_number,
                absolute_order, display_title, availability,
                created_at_ms, updated_at_ms
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'available', ?7, ?7)",
            params![
                membership.collection_id,
                membership.project_id,
                membership.season_number,
                membership.episode_number,
                membership.absolute_order,
                membership.display_title,
                timestamp,
            ],
        )?;
        Ok(())
    }

    pub(crate) fn remove_membership(
        &self,
        collection_id: &str,
        project_id: &str,
    ) -> Result<(), LibraryError> {
        let changed = self.connection.execute(
            "DELETE FROM collection_items
             WHERE collection_id = ?1 AND project_id = ?2",
            params![collection_id, project_id],
        )?;
        if changed == 0 {
            return Err(LibraryError::MembershipNotFound {
                collection_id: collection_id.to_owned(),
                project_id: project_id.to_owned(),
            });
        }
        Ok(())
    }

    pub(crate) fn counts(&self) -> Result<(i64, i64, i64), LibraryError> {
        self.connection
            .query_row(
                "SELECT
                    (SELECT COUNT(*) FROM projects),
                    (SELECT COUNT(*) FROM collection_items),
                    (SELECT COUNT(*) FROM projects p WHERE NOT EXISTS (
                        SELECT 1 FROM collection_items ci WHERE ci.project_id = p.id
                    ))",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .map_err(Into::into)
    }
}

pub(crate) struct NewMembership<'value> {
    pub(crate) collection_id: &'value str,
    pub(crate) project_id: &'value str,
    pub(crate) season_number: Option<i64>,
    pub(crate) episode_number: Option<i64>,
    pub(crate) absolute_order: i64,
    pub(crate) display_title: &'value str,
}

pub(crate) struct NewLibraryRoot<'value> {
    pub(crate) id: &'value str,
    pub(crate) path: &'value str,
    pub(crate) path_key: &'value str,
    pub(crate) display_name: &'value str,
    pub(crate) timestamp: i64,
}

pub(crate) struct ExistingMediaLocator {
    pub(crate) project_id: String,
    pub(crate) locator: String,
    pub(crate) source_size_bytes: Option<i64>,
    pub(crate) source_modified_at_ms: Option<i64>,
}

pub(crate) struct ExistingFingerprint {
    pub(crate) quick_fingerprint: String,
    pub(crate) locator: String,
}

pub(crate) struct NewImportedProject<'value> {
    pub(crate) project_id: &'value str,
    pub(crate) media_source_id: &'value str,
    pub(crate) title: &'value str,
    pub(crate) locator: &'value str,
    pub(crate) display_name: &'value str,
    pub(crate) source_size_bytes: i64,
    pub(crate) source_modified_at_ms: Option<i64>,
    pub(crate) timestamp: i64,
}

pub(crate) struct NewImportedMembership<'value> {
    pub(crate) collection_id: &'value str,
    pub(crate) project_id: &'value str,
    pub(crate) season_number: Option<i64>,
    pub(crate) episode_number: Option<i64>,
    pub(crate) absolute_order: i64,
    pub(crate) display_title: &'value str,
    pub(crate) relative_path: &'value str,
    pub(crate) relative_path_key: &'value str,
    pub(crate) source_size_bytes: i64,
    pub(crate) source_modified_at_ms: Option<i64>,
    pub(crate) quick_fingerprint: &'value str,
    pub(crate) timestamp: i64,
}

fn map_collection(row: &Row<'_>) -> rusqlite::Result<Collection> {
    let kind = row.get::<_, String>(1)?;
    let sort_mode = row.get::<_, String>(6)?;
    Ok(Collection {
        id: row.get(0)?,
        kind: CollectionKind::from_database_value(&kind).map_err(as_sql_error)?,
        title: row.get(2)?,
        root_id: row.get(3)?,
        system_key: row.get(4)?,
        poster_path: row.get(5)?,
        sort_mode: CollectionSortMode::from_database_value(&sort_mode).map_err(as_sql_error)?,
        auto_play_next: row.get::<_, i64>(7)? != 0,
        last_opened_at_ms: row.get(8)?,
        created_at_ms: row.get(9)?,
        updated_at_ms: row.get(10)?,
    })
}

fn map_collection_summary(row: &Row<'_>) -> Result<CollectionSummary, LibraryError> {
    Ok(CollectionSummary {
        collection: map_collection(row)?,
        item_count: row.get(11)?,
        season_count: row.get(12)?,
        watched_count: row.get(13)?,
        total_duration_ms: row.get(14)?,
    })
}

fn map_media_summary(row: &Row<'_>) -> Result<MediaSummary, LibraryError> {
    let locator = row.get::<_, String>(3)?;
    let availability = row
        .get::<_, Option<String>>(18)?
        .map(|value| ItemAvailability::from_database_value(&value))
        .transpose()?;
    Ok(MediaSummary {
        project_id: row.get(0)?,
        project_title: row.get(1)?,
        display_name: row.get(2)?,
        media_available: Path::new(&locator).is_file(),
        media_locator: locator,
        poster_path: row.get(4)?,
        position_ms: row.get(5)?,
        duration_ms: row.get(6)?,
        completed_at_ms: row.get(7)?,
        last_opened_at_ms: row.get(8)?,
        created_at_ms: row.get(9)?,
        original_subtitle_available: row.get(10)?,
        chinese_translation_available: row.get(11)?,
        collection_id: row.get(12)?,
        collection_title: row.get(13)?,
        season_number: row.get(14)?,
        episode_number: row.get(15)?,
        absolute_order: row.get(16)?,
        episode_title: row.get(17)?,
        item_availability: availability,
    })
}

fn as_sql_error(error: LibraryError) -> rusqlite::Error {
    rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Text, Box::new(error))
}
