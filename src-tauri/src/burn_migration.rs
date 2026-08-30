use rusqlite::{Connection, params};

pub(crate) fn migrate_schema_19(
    connection: &mut Connection,
    applied_at_ms: i64,
) -> rusqlite::Result<()> {
    connection.pragma_update(None, "foreign_keys", "OFF")?;
    let migration = (|| {
        let transaction = connection.transaction()?;
        transaction.execute_batch(
            "CREATE TABLE agent_tasks_v19 (
                id TEXT PRIMARY KEY,
                project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
                task_type TEXT NOT NULL CHECK (task_type IN ('subtitle_translation')),
                handoff_kind TEXT NOT NULL CHECK (handoff_kind IN ('manual', 'codex')),
                protocol_version TEXT NOT NULL,
                status TEXT NOT NULL CHECK (
                    status IN (
                        'awaiting_external_result', 'queued', 'running', 'validating',
                        'completed', 'failed', 'cancelled', 'interrupted'
                    )
                ),
                stage TEXT NOT NULL,
                progress REAL NOT NULL CHECK (progress >= 0.0 AND progress <= 1.0),
                receiver_label TEXT NOT NULL,
                material_scope_json TEXT NOT NULL,
                source_version_id TEXT NOT NULL
                    REFERENCES subtitle_versions(id) ON DELETE CASCADE,
                source_language_code TEXT NOT NULL
                    CHECK (length(source_language_code) BETWEEN 2 AND 35),
                target_language_code TEXT NOT NULL
                    CHECK (length(target_language_code) BETWEEN 2 AND 35),
                authorized_segment_ids_json TEXT NOT NULL,
                segment_count INTEGER NOT NULL CHECK (segment_count > 0),
                expected_project_revision INTEGER NOT NULL
                    CHECK (expected_project_revision >= 1),
                expected_media_sha256 TEXT NOT NULL
                    CHECK (length(expected_media_sha256) = 64),
                material_manifest_sha256 TEXT NOT NULL
                    CHECK (length(material_manifest_sha256) = 64),
                result_sha256 TEXT
                    CHECK (result_sha256 IS NULL OR length(result_sha256) = 64),
                result_validation_json TEXT,
                output_version_id TEXT REFERENCES subtitle_versions(id) ON DELETE SET NULL,
                runner_version TEXT,
                runner_auth_mode TEXT,
                runner_thread_id TEXT,
                cancel_requested_at_ms INTEGER,
                error_code TEXT,
                error_message TEXT,
                created_at_ms INTEGER NOT NULL,
                updated_at_ms INTEGER NOT NULL,
                started_at_ms INTEGER,
                completed_at_ms INTEGER,
                base_translation_version_id TEXT
                    REFERENCES subtitle_versions(id) ON DELETE SET NULL,
                execution_kind TEXT NOT NULL DEFAULT 'manual'
                    CHECK (execution_kind IN ('manual', 'codex', 'api')),
                service_config_id TEXT,
                service_revision INTEGER,
                provider_id TEXT,
                model_id TEXT,
                provider_request_id TEXT,
                usage_json TEXT
             );

             INSERT INTO agent_tasks_v19 SELECT * FROM agent_tasks;
             DROP TABLE agent_tasks;
             ALTER TABLE agent_tasks_v19 RENAME TO agent_tasks;

             CREATE INDEX agent_tasks_project_created
             ON agent_tasks(project_id, created_at_ms DESC);

             CREATE UNIQUE INDEX one_active_translation_task_per_project
             ON agent_tasks(project_id)
             WHERE status IN (
                'awaiting_external_result', 'queued', 'running', 'validating'
             );

             ALTER TABLE subtitle_burn_jobs
         ADD COLUMN burn_style_json TEXT NOT NULL
         DEFAULT '{\"textSize\":\"medium\",\"positionY\":0.96}';",
        )?;
        let violations: i64 =
            transaction.query_row("SELECT COUNT(*) FROM pragma_foreign_key_check", [], |row| {
                row.get(0)
            })?;
        if violations > 0 {
            return Err(rusqlite::Error::InvalidQuery);
        }
        transaction.execute(
            "INSERT INTO schema_migrations (version, applied_at_ms) VALUES (19, ?1)",
            params![applied_at_ms],
        )?;
        transaction.commit()
    })();
    let restore = connection.pragma_update(None, "foreign_keys", "ON");
    migration?;
    restore?;
    Ok(())
}
