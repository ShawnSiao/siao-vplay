use rusqlite::Transaction;

use crate::store::StoreError;

pub(crate) fn apply_schema_18(transaction: &Transaction<'_>) -> Result<(), StoreError> {
    transaction.execute_batch(
        "CREATE TABLE analysis_prompt_templates (
            id TEXT PRIMARY KEY,
            task_type TEXT NOT NULL CHECK (task_type IN ('understanding', 'summary')),
            base_template_id TEXT NOT NULL
                REFERENCES analysis_prompt_templates(id) ON DELETE RESTRICT
                DEFERRABLE INITIALLY DEFERRED,
            name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 80),
            custom_requirements TEXT NOT NULL
                CHECK (length(custom_requirements) <= 8000),
            is_builtin INTEGER NOT NULL CHECK (is_builtin IN (0, 1)),
            created_at_ms INTEGER NOT NULL CHECK (created_at_ms >= 0),
            updated_at_ms INTEGER NOT NULL CHECK (updated_at_ms >= created_at_ms)
         );

         CREATE UNIQUE INDEX analysis_prompt_templates_task_name
         ON analysis_prompt_templates(task_type, name);

         CREATE INDEX analysis_prompt_templates_task_updated
         ON analysis_prompt_templates(task_type, is_builtin DESC, updated_at_ms DESC);

         CREATE TABLE summary_tasks (
            id TEXT PRIMARY KEY,
            project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
            scope TEXT NOT NULL CHECK (scope IN ('current_progress', 'full_video')),
            playback_cutoff_ms INTEGER CHECK (
                playback_cutoff_ms IS NULL OR playback_cutoff_ms >= 0
            ),
            analysis_mode TEXT NOT NULL CHECK (
                analysis_mode IN (
                    'automatic', 'general', 'science_technology', 'software_architecture'
                )
            ),
            execution_kind TEXT NOT NULL CHECK (execution_kind IN ('manual', 'codex', 'api')),
            prompt_snapshot_json TEXT NOT NULL,
            prompt_snapshot_sha256 TEXT NOT NULL CHECK (length(prompt_snapshot_sha256) = 64),
            subtitle_version_id TEXT NOT NULL
                REFERENCES subtitle_versions(id) ON DELETE RESTRICT,
            material_manifest_sha256 TEXT NOT NULL CHECK (length(material_manifest_sha256) = 64),
            visual_material_authorized INTEGER NOT NULL CHECK (
                visual_material_authorized IN (0, 1)
            ),
            spoiler_confirmed INTEGER NOT NULL CHECK (spoiler_confirmed IN (0, 1)),
            status TEXT NOT NULL CHECK (
                status IN (
                    'prepared', 'awaiting_external_result', 'queued', 'running', 'paused',
                    'validating', 'completed', 'failed', 'cancelled', 'interrupted'
                )
            ),
            stage TEXT NOT NULL,
            progress REAL NOT NULL CHECK (progress >= 0.0 AND progress <= 1.0),
            service_config_id TEXT,
            service_revision INTEGER,
            provider_id TEXT,
            model_id TEXT,
            output_summary_id TEXT
                REFERENCES video_summaries(id) ON DELETE SET NULL
                DEFERRABLE INITIALLY DEFERRED,
            cancel_requested_at_ms INTEGER,
            error_code TEXT,
            error_message TEXT,
            created_at_ms INTEGER NOT NULL,
            updated_at_ms INTEGER NOT NULL,
            started_at_ms INTEGER,
            completed_at_ms INTEGER,
            CHECK (scope != 'current_progress' OR playback_cutoff_ms IS NOT NULL),
            CHECK (scope != 'full_video' OR spoiler_confirmed = 1)
         );

         CREATE INDEX summary_tasks_project_created
         ON summary_tasks(project_id, created_at_ms DESC);

         CREATE UNIQUE INDEX one_active_summary_per_project
         ON summary_tasks(project_id)
         WHERE status IN (
            'prepared', 'awaiting_external_result', 'queued', 'running', 'paused', 'validating'
         );

         CREATE TABLE summary_chunks (
            id TEXT PRIMARY KEY,
            task_id TEXT NOT NULL REFERENCES summary_tasks(id) ON DELETE CASCADE,
            ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
            start_ms INTEGER NOT NULL CHECK (start_ms >= 0),
            end_ms INTEGER NOT NULL CHECK (end_ms >= start_ms),
            segment_ids_json TEXT NOT NULL,
            context_segment_ids_json TEXT NOT NULL,
            frame_manifest_json TEXT NOT NULL,
            material_sha256 TEXT NOT NULL CHECK (length(material_sha256) = 64),
            status TEXT NOT NULL CHECK (
                status IN ('prepared', 'queued', 'running', 'completed', 'failed', 'cancelled')
            ),
            result_json TEXT,
            result_sha256 TEXT CHECK (result_sha256 IS NULL OR length(result_sha256) = 64),
            retry_count INTEGER NOT NULL DEFAULT 0 CHECK (retry_count BETWEEN 0 AND 2),
            error_code TEXT,
            error_message TEXT,
            created_at_ms INTEGER NOT NULL,
            updated_at_ms INTEGER NOT NULL,
            started_at_ms INTEGER,
            completed_at_ms INTEGER,
            UNIQUE(task_id, ordinal)
         );

         CREATE INDEX summary_chunks_task_status
         ON summary_chunks(task_id, status, ordinal);

         CREATE TABLE video_summaries (
            id TEXT PRIMARY KEY,
            task_id TEXT NOT NULL UNIQUE
                REFERENCES summary_tasks(id) ON DELETE CASCADE,
            project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
            protocol_version TEXT NOT NULL CHECK (protocol_version = 'siaovplay-summary-v1'),
            scope TEXT NOT NULL CHECK (scope IN ('current_progress', 'full_video')),
            playback_cutoff_ms INTEGER,
            analysis_mode TEXT NOT NULL,
            subtitle_version_id TEXT NOT NULL
                REFERENCES subtitle_versions(id) ON DELETE RESTRICT,
            material_manifest_sha256 TEXT NOT NULL CHECK (length(material_manifest_sha256) = 64),
            structured_result_json TEXT NOT NULL,
            visual_material_used INTEGER NOT NULL CHECK (visual_material_used IN (0, 1)),
            created_at_ms INTEGER NOT NULL,
            updated_at_ms INTEGER NOT NULL
         );

         CREATE INDEX video_summaries_project_created
         ON video_summaries(project_id, created_at_ms DESC);",
    )?;
    Ok(())
}
