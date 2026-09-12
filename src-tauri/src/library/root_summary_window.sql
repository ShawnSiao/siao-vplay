WITH selected AS MATERIALIZED (
    SELECT * FROM library_roots
    ORDER BY display_name COLLATE NOCASE, id
    LIMIT ?1 OFFSET ?2
)
SELECT lr.id, lr.path, lr.display_name, lr.availability, lr.last_scanned_at_ms,
    (SELECT COUNT(DISTINCT root_item.project_id)
     FROM library_root_items root_item WHERE root_item.root_id = lr.id),
    COUNT(DISTINCT CASE WHEN c.system_key IS NULL THEN c.id END)
FROM selected lr
LEFT JOIN collections c ON c.root_id = lr.id
GROUP BY lr.id
ORDER BY lr.display_name COLLATE NOCASE, lr.id
