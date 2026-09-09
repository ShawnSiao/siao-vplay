WITH matching_media AS (
    SELECT
        CASE WHEN ci.collection_id IS NULL THEN 'unclassified' ELSE 'episode' END AS result_kind,
        p.title,
        CASE WHEN c.title IS NULL THEN m.display_name ELSE c.title END AS subtitle,
        ci.collection_id,
        p.id AS project_id,
        ci.season_number,
        ci.episode_number,
        ROW_NUMBER() OVER (PARTITION BY p.id ORDER BY ci.collection_id) AS match_rank
    FROM projects p
    JOIN media_sources m ON m.project_id = p.id AND m.is_primary = 1
    LEFT JOIN collection_items ci ON ci.project_id = p.id
    LEFT JOIN collections c ON c.id = ci.collection_id
    WHERE p.title LIKE ?1 ESCAPE '\' COLLATE NOCASE
       OR m.display_name LIKE ?1 ESCAPE '\' COLLATE NOCASE
       OR ci.display_title LIKE ?1 ESCAPE '\' COLLATE NOCASE
)
SELECT
    'collection' AS result_kind,
    c.title,
    CASE c.kind WHEN 'series' THEN '剧集' WHEN 'folder' THEN '文件夹' ELSE '合集' END AS subtitle,
    c.id AS collection_id,
    NULL AS project_id,
    NULL AS season_number,
    NULL AS episode_number
FROM collections c
WHERE c.title LIKE ?1 ESCAPE '\' COLLATE NOCASE
UNION ALL
SELECT result_kind, title, subtitle, collection_id, project_id, season_number, episode_number
FROM matching_media
WHERE match_rank = 1
ORDER BY title COLLATE NOCASE, result_kind, project_id
LIMIT ?2
