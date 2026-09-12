-- Select the ordered page before hydrating media details and subtitle status.
WITH episode_window AS MATERIALIZED (
    SELECT ci.project_id
    FROM collection_items ci
    JOIN collections c ON c.id = ci.collection_id
    JOIN projects p ON p.id = ci.project_id
    JOIN media_sources m ON m.project_id = p.id AND m.is_primary = 1
    JOIN playback_states ps ON ps.project_id = p.id
    WHERE ci.collection_id = ?1 AND (?2 IS NULL OR ci.season_number = ?2)
             ORDER BY
                CASE WHEN c.sort_mode = 'manual' THEN ci.absolute_order END,
                CASE WHEN c.sort_mode != 'manual' THEN ci.season_number END,
                CASE WHEN c.sort_mode != 'manual' THEN ci.episode_number END,
                ci.absolute_order,
                ci.display_title COLLATE NOCASE,
                ci.project_id

    LIMIT ?3 OFFSET ?4
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
                c.id, c.title, ci.season_number, ci.episode_number,
                ci.absolute_order, ci.display_title, ci.availability
             FROM episode_window ew
             JOIN collection_items ci ON ci.project_id = ew.project_id AND ci.collection_id = ?1
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
                ci.project_id
