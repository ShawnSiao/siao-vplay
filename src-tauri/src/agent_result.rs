use std::path::Path;

use serde_json::Value;

const JSON_SCHEMA_DIALECT: &str = "https://json-schema.org/draft/2020-12/schema";

pub(crate) fn schema_for_prompt(schema: &Value) -> Value {
    let mut prompt_schema = schema.clone();
    if let Some(object) = prompt_schema.as_object_mut() {
        object.remove("$schema");
    }
    prompt_schema
}

pub(crate) fn normalize_external_result(raw: &str) -> Result<String, String> {
    let mut value = serde_json::from_str::<Value>(raw.trim_start_matches('\u{feff}'))
        .map_err(|error| format!("结果 JSON 无效：{error}"))?;
    let object = value
        .as_object_mut()
        .ok_or_else(|| "结果必须是一个 JSON 对象".to_owned())?;
    if let Some(schema) = object.remove("$schema") {
        if schema.as_str() != Some(JSON_SCHEMA_DIALECT) {
            return Err("结果中的 `$schema` 值不受支持，请删除该字段后重试".to_owned());
        }
    }
    serde_json::to_string(&value).map_err(|error| format!("结果 JSON 无法规范化：{error}"))
}

pub(crate) fn manual_return_instructions(result_path: &Path, fields: &[&str]) -> String {
    let field_list = fields
        .iter()
        .map(|field| format!("`{field}`"))
        .collect::<Vec<_>>()
        .join("、");
    format!(
        "## 返回要求\n\n\
- 下方 JSON Schema 只是校验规则，不是返回对象模板。\n\
- 返回对象只能包含这些业务字段：{field_list}。\n\
- 不要返回 `$schema`、`type`、`properties`、`required` 或 `additionalProperties` 等 Schema 元数据。\n\
- 只返回一个 JSON 对象，不要使用 Markdown 代码围栏，不要附加解释。\n\
- 如果当前工具可以写入本地文件，请先写入 `{0}.part`，完成后再重命名为 `{0}`；SiaoVPlay 会自动检测。\n\
- 如果当前工具只能聊天，请在聊天中返回纯 JSON；随后将该对象以 UTF-8 编码保存为 `result.json`，放入 SiaoVPlay 打开的自动返回目录，或在 SiaoVPlay 中手动选择该文件。\n\n",
        result_path.display()
    )
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{normalize_external_result, schema_for_prompt};

    #[test]
    fn prompt_schema_omits_dialect_metadata() {
        let schema = json!({
            "$schema": "https://json-schema.org/draft/2020-12/schema",
            "type": "object"
        });

        assert_eq!(schema_for_prompt(&schema), json!({"type": "object"}));
    }

    #[test]
    fn known_schema_echo_is_removed_from_external_result() {
        let raw = r#"{"$schema":"https://json-schema.org/draft/2020-12/schema","taskId":"task"}"#;

        assert_eq!(
            normalize_external_result(raw).unwrap(),
            r#"{"taskId":"task"}"#
        );
    }

    #[test]
    fn unknown_schema_echo_is_rejected() {
        let raw = r#"{"$schema":"https://example.com/schema","taskId":"task"}"#;

        assert!(normalize_external_result(raw).is_err());
    }
}
