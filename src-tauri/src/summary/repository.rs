use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{OptionalExtension, TransactionBehavior, params};
use uuid::Uuid;

use super::{
    model::{AnalysisPromptTemplate, AnalysisTaskType, SaveAnalysisPromptTemplateInput},
    prompts::{compose_prompt_snapshot, validate_template_name, validate_template_requirements},
};
use crate::store::{ProjectStore, StoreError};

pub(crate) struct PromptTemplateRepository<'a> {
    store: &'a ProjectStore,
}

impl<'a> PromptTemplateRepository<'a> {
    pub(crate) fn new(store: &'a ProjectStore) -> Self {
        Self { store }
    }

    pub(crate) fn list(
        &self,
        task_type: Option<AnalysisTaskType>,
    ) -> Result<Vec<AnalysisPromptTemplate>, StoreError> {
        let connection = self.store.connect()?;
        let sql = if task_type.is_some() {
            "SELECT id, task_type, base_template_id, name, custom_requirements,
                    is_builtin, created_at_ms, updated_at_ms
             FROM analysis_prompt_templates
             WHERE task_type = ?1
             ORDER BY is_builtin DESC, updated_at_ms DESC, name ASC"
        } else {
            "SELECT id, task_type, base_template_id, name, custom_requirements,
                    is_builtin, created_at_ms, updated_at_ms
             FROM analysis_prompt_templates
             ORDER BY task_type ASC, is_builtin DESC, updated_at_ms DESC, name ASC"
        };
        let mut statement = connection.prepare(sql)?;
        let raw_rows = if let Some(task_type) = task_type {
            statement
                .query_map(params![task_type.as_database_value()], read_raw_row)?
                .collect::<Result<Vec<_>, _>>()?
        } else {
            statement
                .query_map([], read_raw_row)?
                .collect::<Result<Vec<_>, _>>()?
        };
        raw_rows.into_iter().map(RawTemplate::convert).collect()
    }

    pub(crate) fn get(&self, id: &str) -> Result<AnalysisPromptTemplate, StoreError> {
        let connection = self.store.connect()?;
        let raw = connection
            .query_row(
                "SELECT id, task_type, base_template_id, name, custom_requirements,
                        is_builtin, created_at_ms, updated_at_ms
                 FROM analysis_prompt_templates WHERE id = ?1",
                params![id],
                read_raw_row,
            )
            .optional()?
            .ok_or_else(|| StoreError::Validation("分析提示词模板不存在".to_owned()))?;
        raw.convert()
    }

    pub(crate) fn snapshot(
        &self,
        id: &str,
        one_time_requirements: &str,
    ) -> Result<super::model::PromptSnapshot, StoreError> {
        let mut template = self.get(id)?;
        if !template.is_builtin {
            let base = self.get(&template.base_template_id)?;
            if !base.is_builtin || base.task_type != template.task_type {
                return Err(StoreError::Validation(
                    "个人模板的内置基础模板无效".to_owned(),
                ));
            }
            template.custom_requirements = format!(
                "基础模板要求：{}\n个人模板要求：{}",
                base.custom_requirements, template.custom_requirements
            );
        }
        compose_prompt_snapshot(&template, one_time_requirements)
    }

    pub(crate) fn save(
        &self,
        input: SaveAnalysisPromptTemplateInput,
    ) -> Result<AnalysisPromptTemplate, StoreError> {
        let name = input.name.trim();
        let requirements = input.custom_requirements.trim();
        validate_template_name(name)?;
        validate_template_requirements(requirements)?;
        let base = self.get(&input.base_template_id)?;
        if !base.is_builtin || base.task_type != input.task_type {
            return Err(StoreError::Validation(
                "个人模板必须选择同一任务类型的内置基础模板".to_owned(),
            ));
        }
        let id = input
            .id
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_owned)
            .unwrap_or_else(|| Uuid::new_v4().to_string());
        let timestamp = now_ms()?;
        let mut connection = self.store.connect()?;
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let existing = transaction
            .query_row(
                "SELECT is_builtin, created_at_ms
                 FROM analysis_prompt_templates WHERE id = ?1",
                params![id],
                |row| Ok((row.get::<_, bool>(0)?, row.get::<_, i64>(1)?)),
            )
            .optional()?;
        if matches!(existing, Some((true, _))) {
            return Err(StoreError::Validation("内置提示词模板不可修改".to_owned()));
        }
        let created_at_ms = existing.map(|(_, created)| created).unwrap_or(timestamp);
        transaction.execute(
            "INSERT INTO analysis_prompt_templates (
                id, task_type, base_template_id, name, custom_requirements,
                is_builtin, created_at_ms, updated_at_ms
             ) VALUES (?1, ?2, ?3, ?4, ?5, 0, ?6, ?7)
             ON CONFLICT(id) DO UPDATE SET
                task_type = excluded.task_type,
                base_template_id = excluded.base_template_id,
                name = excluded.name,
                custom_requirements = excluded.custom_requirements,
                updated_at_ms = excluded.updated_at_ms
             WHERE analysis_prompt_templates.is_builtin = 0",
            params![
                id,
                input.task_type.as_database_value(),
                input.base_template_id,
                name,
                requirements,
                created_at_ms,
                timestamp
            ],
        )?;
        transaction.commit()?;
        self.get(&id)
    }

    pub(crate) fn delete(&self, id: &str) -> Result<(), StoreError> {
        let id = id.trim();
        if id.is_empty() {
            return Err(StoreError::Validation("模板 ID 不能为空".to_owned()));
        }
        let mut connection = self.store.connect()?;
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let built_in = transaction
            .query_row(
                "SELECT is_builtin FROM analysis_prompt_templates WHERE id = ?1",
                params![id],
                |row| row.get::<_, bool>(0),
            )
            .optional()?
            .ok_or_else(|| StoreError::Validation("分析提示词模板不存在".to_owned()))?;
        if built_in {
            return Err(StoreError::Validation("内置提示词模板不可删除".to_owned()));
        }
        transaction.execute(
            "DELETE FROM analysis_prompt_templates WHERE id = ?1 AND is_builtin = 0",
            params![id],
        )?;
        transaction.commit()?;
        Ok(())
    }
}

struct RawTemplate {
    id: String,
    task_type: String,
    base_template_id: String,
    name: String,
    custom_requirements: String,
    is_builtin: bool,
    created_at_ms: i64,
    updated_at_ms: i64,
}

impl RawTemplate {
    fn convert(self) -> Result<AnalysisPromptTemplate, StoreError> {
        Ok(AnalysisPromptTemplate {
            id: self.id,
            task_type: AnalysisTaskType::from_database(&self.task_type)?,
            base_template_id: self.base_template_id,
            name: self.name,
            custom_requirements: self.custom_requirements,
            is_builtin: self.is_builtin,
            created_at_ms: self.created_at_ms,
            updated_at_ms: self.updated_at_ms,
        })
    }
}

fn read_raw_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<RawTemplate> {
    Ok(RawTemplate {
        id: row.get(0)?,
        task_type: row.get(1)?,
        base_template_id: row.get(2)?,
        name: row.get(3)?,
        custom_requirements: row.get(4)?,
        is_builtin: row.get(5)?,
        created_at_ms: row.get(6)?,
        updated_at_ms: row.get(7)?,
    })
}

fn now_ms() -> Result<i64, StoreError> {
    let duration = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| StoreError::Validation("系统时间早于 Unix epoch".to_owned()))?;
    i64::try_from(duration.as_millis())
        .map_err(|_| StoreError::Validation("系统时间超出支持范围".to_owned()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn store() -> (tempfile::TempDir, ProjectStore) {
        let directory = tempfile::tempdir().unwrap();
        let store = ProjectStore::open(directory.path().join("projects.sqlite3")).unwrap();
        (directory, store)
    }

    #[test]
    fn lists_built_ins_and_cruds_personal_templates() {
        let (_directory, store) = store();
        let repository = PromptTemplateRepository::new(&store);
        let built_ins = repository.list(Some(AnalysisTaskType::Summary)).unwrap();
        assert_eq!(built_ins.len(), 4);
        assert!(built_ins.iter().all(|template| template.is_builtin));

        let created = repository
            .save(SaveAnalysisPromptTemplateInput {
                id: None,
                task_type: AnalysisTaskType::Summary,
                base_template_id: "builtin:summary:science-technology".to_owned(),
                name: "我的技术复盘".to_owned(),
                custom_requirements: "优先解释数据流".to_owned(),
            })
            .unwrap();
        assert!(!created.is_builtin);
        let updated = repository
            .save(SaveAnalysisPromptTemplateInput {
                id: Some(created.id.clone()),
                task_type: AnalysisTaskType::Summary,
                base_template_id: "builtin:summary:software-architecture".to_owned(),
                name: "我的架构复盘".to_owned(),
                custom_requirements: "关注失败路径".to_owned(),
            })
            .unwrap();
        assert_eq!(updated.name, "我的架构复盘");
        let snapshot = repository.snapshot(&updated.id, "补充说明边界").unwrap();
        assert!(snapshot.template_requirements.contains("失败路径"));
        assert!(snapshot.template_requirements.contains("个人模板要求"));
        repository.delete(&created.id).unwrap();
        assert!(repository.get(&created.id).is_err());
    }

    #[test]
    fn rejects_built_in_mutation_and_cross_task_bases() {
        let (_directory, store) = store();
        let repository = PromptTemplateRepository::new(&store);
        assert!(repository.delete("builtin:summary:automatic").is_err());
        assert!(
            repository
                .save(SaveAnalysisPromptTemplateInput {
                    id: Some("builtin:summary:automatic".to_owned()),
                    task_type: AnalysisTaskType::Summary,
                    base_template_id: "builtin:summary:automatic".to_owned(),
                    name: "覆盖".to_owned(),
                    custom_requirements: String::new(),
                })
                .is_err()
        );
        assert!(
            repository
                .save(SaveAnalysisPromptTemplateInput {
                    id: None,
                    task_type: AnalysisTaskType::Understanding,
                    base_template_id: "builtin:summary:automatic".to_owned(),
                    name: "错误基础".to_owned(),
                    custom_requirements: String::new(),
                })
                .is_err()
        );
    }
}
