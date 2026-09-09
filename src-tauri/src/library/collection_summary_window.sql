WITH selected AS MATERIALIZED (
    SELECT * FROM collections c
    WHERE (?3 IS NULL OR (c.system_key IS NULL AND (c.root_id IS NOT NULL) = ?3))
        AND (?5 OR c.system_key IS NULL)
        AND instr(lower(c.title), lower(?4)) > 0
    ORDER BY CASE WHEN c.system_key = 'watch_later' THEN 1 ELSE 0 END,
        COALESCE(c.last_opened_at_ms, 0) DESC, c.updated_at_ms DESC,
        c.title COLLATE NOCASE, c.id
    LIMIT ?1 OFFSET ?2
)
SELECT c.id, c.kind, c.title, c.root_id, c.system_key, c.poster_path,
    c.sort_mode, c.auto_play_next, c.last_opened_at_ms, c.created_at_ms, c.updated_at_ms,
    COUNT(ci.project_id), COUNT(DISTINCT ci.season_number),
    COALESCE(SUM(CASE WHEN ps.completed_at_ms IS NOT NULL THEN 1 ELSE 0 END), 0),
    SUM(ps.duration_ms)
FROM selected c
LEFT JOIN collection_items ci ON ci.collection_id = c.id
LEFT JOIN playback_states ps ON ps.project_id = ci.project_id
GROUP BY c.id
ORDER BY CASE WHEN c.system_key = 'watch_later' THEN 1 ELSE 0 END,
    COALESCE(c.last_opened_at_ms, 0) DESC, c.updated_at_ms DESC,
    c.title COLLATE NOCASE, c.id
