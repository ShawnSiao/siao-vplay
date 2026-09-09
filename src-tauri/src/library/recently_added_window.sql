WITH selected AS MATERIALIZED (
    SELECT p.id
    FROM projects p
    JOIN media_sources m ON m.project_id = p.id AND m.is_primary = 1
    JOIN playback_states ps ON ps.project_id = p.id
    ORDER BY p.created_at_ms DESC, p.id
    LIMIT ?1
)
SELECT
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
   ci.collection_id, c.title, ci.season_number,
   ci.episode_number, ci.absolute_order, ci.display_title,
   ci.availability
FROM selected window_rows
JOIN projects p ON p.id = window_rows.id
JOIN media_sources m ON m.project_id = p.id AND m.is_primary = 1
JOIN playback_states ps ON ps.project_id = p.id
LEFT JOIN collection_items ci ON ci.project_id = p.id
   AND ci.collection_id = (
       SELECT member.collection_id FROM collection_items member
       WHERE member.project_id = p.id
       ORDER BY member.collection_id LIMIT 1
   )
LEFT JOIN collections c ON c.id = ci.collection_id
ORDER BY p.created_at_ms DESC, p.id
