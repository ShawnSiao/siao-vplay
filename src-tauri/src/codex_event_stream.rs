use std::io::{BufRead, Write};
use std::path::Path;

use serde_json::Value;

#[derive(Debug, Default)]
pub(crate) struct EventSummary {
    pub(crate) thread_id: Option<String>,
    pub(crate) saw_turn_completed: bool,
    pub(crate) saw_error: bool,
    pub(crate) error_message: Option<String>,
    pub(crate) saw_tool_activity: bool,
}

pub(crate) fn parse_events_and_save(
    reader: impl BufRead,
    events_path: &Path,
) -> Result<EventSummary, std::io::Error> {
    let mut output = std::fs::File::create(events_path)?;
    let mut summary = EventSummary::default();
    for line in reader.lines() {
        let line = match line {
            Ok(line) => line,
            Err(error) => {
                summary.saw_error = true;
                writeln!(output, "{{\"type\":\"runner.read_error\"}}")?;
                return Err(error);
            }
        };
        writeln!(output, "{line}")?;
        let Ok(value) = serde_json::from_str::<Value>(&line) else {
            summary.saw_error = true;
            continue;
        };
        match value.get("type").and_then(Value::as_str) {
            Some("thread.started") => {
                summary.thread_id = value
                    .get("thread_id")
                    .or_else(|| value.get("threadId"))
                    .and_then(Value::as_str)
                    .map(str::to_owned);
            }
            Some("turn.completed") => summary.saw_turn_completed = true,
            Some("turn.failed" | "error") => {
                summary.saw_error = true;
                if summary.error_message.is_none() {
                    summary.error_message = event_error_message(&value);
                }
            }
            _ => {}
        }
        let item_type = value
            .get("item")
            .and_then(|item| item.get("type"))
            .and_then(Value::as_str);
        if item_type.is_some_and(|kind| {
            matches!(
                kind,
                "command_execution" | "file_change" | "mcp_tool_call" | "web_search"
            )
        }) {
            summary.saw_tool_activity = true;
        }
    }
    Ok(summary)
}

fn event_error_message(value: &Value) -> Option<String> {
    let raw = value
        .get("message")
        .or_else(|| value.pointer("/error/message"))
        .and_then(Value::as_str)?;
    let detail = serde_json::from_str::<Value>(raw)
        .ok()
        .and_then(|nested| {
            nested
                .pointer("/error/message")
                .and_then(Value::as_str)
                .map(str::to_owned)
        })
        .unwrap_or_else(|| raw.to_owned());
    let compact = detail.split_whitespace().collect::<Vec<_>>().join(" ");
    (!compact.is_empty()).then(|| compact.chars().take(320).collect())
}
