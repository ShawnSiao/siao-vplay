SELECT v.id, v.track_id, v.project_id, t.role, v.version_number, v.status,
       v.source_label, v.language_code, v.created_at_ms, 1,
       (SELECT COUNT(*) FROM subtitle_segments s WHERE s.version_id = v.id)
FROM current_tracks t CROSS JOIN subtitle_versions v
WHERE t.project_id = ?1 AND v.id = t.current_version_id
  AND v.track_id = t.id AND v.project_id = t.project_id AND ?4
ORDER BY v.created_at_ms DESC, v.version_number DESC, v.id DESC
LIMIT ?2 OFFSET ?3
