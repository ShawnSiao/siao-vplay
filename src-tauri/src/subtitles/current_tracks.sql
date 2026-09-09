SELECT id, project_id, role, current_version_id
FROM subtitle_tracks
WHERE project_id = ?1 AND role = 'original'
UNION ALL
SELECT id, project_id, role, current_version_id
FROM subtitle_tracks
WHERE project_id = ?1 AND role = 'translation'
