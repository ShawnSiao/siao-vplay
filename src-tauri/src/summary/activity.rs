use crate::store::{ProjectStore, StoreError};
use rusqlite::Connection;
use serde::Serialize;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(schemars::JsonSchema))]
pub struct SummaryActivity {
    id: String,
    project_id: String,
    project_title: String,
    #[cfg_attr(test, schemars(with = "super::wire_schema::TaskStatus"))]
    status: String,
    #[cfg_attr(test, schemars(range(min = 0, max = 9007199254740991_i64)))]
    updated_at_ms: i64,
    has_result: bool,
}

pub fn list(store: &ProjectStore) -> Result<Vec<SummaryActivity>, StoreError> {
    list_on(&store.connect()?)
}
fn list_on(connection: &Connection) -> Result<Vec<SummaryActivity>, StoreError> {
    let mut query = connection.prepare(
        "SELECT t.id, t.project_id, p.title, t.status, t.updated_at_ms,
                t.status = 'completed' AND EXISTS (
                    SELECT 1 FROM video_summaries s WHERE s.id = t.output_summary_id
                    AND s.task_id = t.id AND s.project_id = t.project_id
                )
         FROM summary_tasks t JOIN projects p ON p.id = t.project_id
         ORDER BY t.updated_at_ms DESC, t.id DESC LIMIT 100",
    )?;
    let rows = query.query_map([], |row| {
        Ok(SummaryActivity {
            id: row.get(0)?,
            project_id: row.get(1)?,
            project_title: row.get(2)?,
            status: row.get(3)?,
            updated_at_ms: row.get(4)?,
            has_result: row.get(5)?,
        })
    })?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn activity_is_cross_project_bounded_and_contains_no_material_or_errors() {
        let connection = Connection::open_in_memory().unwrap();
        connection.execute_batch("CREATE TABLE projects(id TEXT, title TEXT);
            CREATE TABLE summary_tasks(id TEXT, project_id TEXT, status TEXT, updated_at_ms INTEGER, output_summary_id TEXT, error_message TEXT);
            CREATE TABLE video_summaries(id TEXT, task_id TEXT, project_id TEXT);
            INSERT INTO projects VALUES('a','视频 A'),('b','视频 B');").unwrap();
        for n in 0..110 {
            connection.execute("INSERT INTO summary_tasks VALUES(?1, ?2, ?3, ?4, NULL, 'private subtitle material')",
                rusqlite::params![n.to_string(), if n % 2 == 0 { "a" } else { "b" }, if n % 2 == 0 { "failed" } else { "running" }, n]).unwrap();
        }
        let activity = list_on(&connection).unwrap();
        assert_eq!(activity.len(), 100);
        assert_eq!(activity[0].id, "109");
        assert_eq!(activity[0].project_title, "视频 B");
        assert_eq!(activity[1].status, "failed");
        assert!(
            !serde_json::to_string(&activity)
                .unwrap()
                .contains("private subtitle material")
        );
    }
    #[test]
    fn query_accepts_the_current_database_schema() {
        let directory = tempfile::tempdir().unwrap();
        let store = ProjectStore::open(directory.path().join("projects.sqlite3")).unwrap();
        assert!(list(&store).unwrap().is_empty());
    }
    #[test]
    fn result_flag_requires_a_matching_saved_summary() {
        let connection = Connection::open_in_memory().unwrap();
        connection.execute_batch("CREATE TABLE projects(id TEXT, title TEXT);
            CREATE TABLE summary_tasks(id TEXT, project_id TEXT, status TEXT, updated_at_ms INTEGER, output_summary_id TEXT);
            CREATE TABLE video_summaries(id TEXT, task_id TEXT, project_id TEXT);
            INSERT INTO projects VALUES('project','视频');
            INSERT INTO summary_tasks VALUES('task','project','completed',1,'missing');
            INSERT INTO video_summaries VALUES('wrong-project','task','other'),('wrong-task','other','project'),('valid','task','project');").unwrap();
        for output in ["missing", "wrong-project", "wrong-task", "valid"] {
            connection.execute("UPDATE summary_tasks SET output_summary_id=?1", [output]).unwrap();
            assert_eq!(list_on(&connection).unwrap()[0].has_result, output == "valid", "{output}");
        }
        connection.execute("UPDATE summary_tasks SET status='running'", []).unwrap();
        assert!(!list_on(&connection).unwrap()[0].has_result);
    }

}
