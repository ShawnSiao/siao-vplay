use super::{providers, types::ResolvedAiService};
use serde_json::{Value, json};

pub(crate) fn explanation_frames_enabled(
    requested: bool,
    service: Option<&ResolvedAiService>,
) -> bool {
    requested
        && service.is_none_or(|resolved| {
            resolved
                .model_id
                .as_deref()
                .is_some_and(|model| providers::model_supports_vision(resolved, model))
        })
}

pub(crate) fn authorized_explanation_prompt(
    prompt: String,
    frame_ids: &[String],
    include_frames: bool,
) -> String {
    if include_frames {
        return prompt;
    }
    let prompt = if let Some(start) = prompt.find("## 已授权关键帧") {
        prompt[start..]
            .find("## 结果校验规则")
            .map(|offset| {
                format!(
                    "{}## 已授权关键帧\n\n本次未授权发送画面。\n\n{}",
                    &prompt[..start],
                    &prompt[start + offset..]
                )
            })
            .unwrap_or(prompt)
    } else {
        prompt
    };
    frame_ids
        .iter()
        .fold(prompt, |text, id| text.replace(id, "frame-not-authorized"))
}

pub(crate) fn authorized_explanation_schema(mut schema: Value, include_frames: bool) -> Value {
    if !include_frames {
        for group in ["confirmedFacts", "possibleInterpretations"] {
            schema["properties"][group]["items"]["properties"]["frameIds"]["items"]["enum"] =
                json!([]);
        }
    }
    schema
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn local_execution_respects_the_explicit_frame_choice() {
        assert!(explanation_frames_enabled(true, None));
        assert!(!explanation_frames_enabled(false, None));
    }

    #[test]
    fn text_only_requests_hide_frame_material_and_restrict_the_schema() {
        let frame_id = "frame-secret".to_owned();
        let prompt = "before\n## 已授权关键帧\nframe-secret\n## 结果校验规则\nframe-secret";
        let redacted = authorized_explanation_prompt(prompt.to_owned(), &[frame_id], false);
        assert!(redacted.contains("本次未授权发送画面"));
        assert!(!redacted.contains("frame-secret"));
        let schema = authorized_explanation_schema(
            json!({"properties": {
                "confirmedFacts": {"items": {"properties": {"frameIds": {"items": {"enum": ["frame-secret"]}}}}},
                "possibleInterpretations": {"items": {"properties": {"frameIds": {"items": {"enum": ["frame-secret"]}}}}}
            }}),
            false,
        );
        assert_eq!(
            schema["properties"]["confirmedFacts"]["items"]["properties"]["frameIds"]["items"]["enum"],
            json!([])
        );
    }
}
