use crate::local_resources::LocalResourceError;
use serde::Serialize;
use std::collections::BTreeSet;

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(schemars::JsonSchema))]
pub struct CleanupInterruption {
    #[cfg_attr(test, schemars(length(min = 1)))]
    pub item_id: String,
    #[cfg_attr(test, schemars(length(min = 1)))]
    pub message: String,
    #[cfg_attr(test, schemars(length(min = 1)))]
    pub remaining_item_ids: Vec<String>,
}
pub struct Outcome {
    pub completed_ids: Vec<String>,
    pub reclaimed_bytes: u64,
    pub interruption: Option<CleanupInterruption>,
}
pub fn run(
    items: Vec<(String, u64)>,
    mut remove: impl FnMut(&str) -> Result<(), String>,
) -> Result<Outcome, LocalResourceError> {
    let mut unique = BTreeSet::new();
    let mut total = 0_u64;
    for (id, bytes) in &items {
        total = total.checked_add(*bytes).ok_or_else(invalid)?;
        if id.trim().is_empty() || !unique.insert(id) || total > 9_007_199_254_740_991 {
            return Err(invalid());
        }
    }
    let mut result = Outcome {
        completed_ids: Vec::new(),
        reclaimed_bytes: 0,
        interruption: None,
    };
    for (index, (id, bytes)) in items.iter().enumerate() {
        if let Err(message) = remove(id) {
            result.interruption = Some(CleanupInterruption {
                item_id: id.clone(),
                message: if message.trim().is_empty() {
                    "清理未完成，请检查资源状态后重试。".into()
                } else {
                    message
                },
                // The failed item may have committed metadata with cleanup pending;
                // remaining means not confirmed complete, not necessarily untouched.
                remaining_item_ids: items[index..].iter().map(|(id, _)| id.clone()).collect(),
            });
            break;
        }
        result.completed_ids.push(id.clone());
        result.reclaimed_bytes += bytes;
    }
    Ok(result)
}
fn invalid() -> LocalResourceError {
    LocalResourceError::InvalidReceipt("清理清单包含重复项目或无效大小，请重新检查清单".into())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn failure_preserves_completed_results_and_does_not_touch_remaining_files() {
        let root = tempfile::tempdir().unwrap();
        for id in ["first", "failed", "last"] {
            std::fs::write(root.path().join(id), id).unwrap();
        }
        let mut calls = Vec::new();
        let result = run(
            vec![
                ("first".into(), 5),
                ("failed".into(), 6),
                ("last".into(), 4),
            ],
            |id| {
                calls.push(id.to_owned());
                if id == "failed" {
                    return Err("locked".into());
                }
                std::fs::remove_file(root.path().join(id)).map_err(|error| error.to_string())
            },
        )
        .unwrap();
        assert_eq!(calls, ["first", "failed"]);
        assert_eq!(result.completed_ids, ["first"]);
        assert_eq!(result.reclaimed_bytes, 5);
        let interruption = result.interruption.unwrap();
        assert_eq!(interruption.item_id, "failed");
        assert_eq!(interruption.remaining_item_ids, ["failed", "last"]);
        assert!(!root.path().join("first").exists());
        assert_eq!(
            std::fs::read(root.path().join("failed")).unwrap(),
            b"failed"
        );
        assert_eq!(std::fs::read(root.path().join("last")).unwrap(), b"last");
    }
    #[test]
    fn first_failure_has_no_confirmed_reclaimed_bytes() {
        let result = run(vec![("first".into(), 12)], |_| Err(String::new())).unwrap();
        assert!(result.completed_ids.is_empty());
        assert_eq!(result.reclaimed_bytes, 0);
        assert!(!result.interruption.unwrap().message.is_empty());
    }
    #[test]
    fn complete_and_empty_batches_have_no_interruption() {
        let result = run(vec![("a".into(), 2), ("b".into(), 3)], |_| Ok(())).unwrap();
        assert_eq!(result.completed_ids, ["a", "b"]);
        assert_eq!(result.reclaimed_bytes, 5);
        assert!(result.interruption.is_none());
        let empty = run(Vec::new(), |_| panic!("empty batch must not execute")).unwrap();
        assert!(empty.completed_ids.is_empty());
        assert!(empty.interruption.is_none());
    }
    #[test]
    fn invalid_plan_is_rejected_before_any_mutation() {
        for items in [
            vec![("a".into(), 1), ("a".into(), 2)],
            vec![(" ".into(), 1)],
            vec![("a".into(), u64::MAX)],
        ] {
            assert!(run(items, |_| panic!("invalid plan must not execute")).is_err());
        }
    }
}
