WITH selected AS MATERIALIZED (
    SELECT v.id
    FROM subtitle_versions v JOIN subtitle_tracks t ON t.id = v.track_id
    WHERE v.project_id = ?1
    ORDER BY v.created_at_ms DESC, v.version_number DESC, v.id DESC
    LIMIT ?2 OFFSET ?3
)
SELECT v.id, v.track_id, v.project_id, t.role, v.version_number, v.status,
       v.source_label, v.language_code, v.created_at_ms,
       CASE WHEN t.current_version_id = v.id THEN 1 ELSE 0 END,
       (SELECT COUNT(*) FROM subtitle_segments s WHERE s.version_id = v.id)
FROM selected JOIN subtitle_versions v ON v.id = selected.id
JOIN subtitle_tracks t ON t.id = v.track_id
ORDER BY v.created_at_ms DESC, v.version_number DESC, v.id DESC
