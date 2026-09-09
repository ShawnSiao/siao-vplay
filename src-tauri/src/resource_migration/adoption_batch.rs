use super::{ResourceMigrationError, contracts::ResourceAdoptionInterruption};
#[derive(Debug, Default)]
pub(super) struct Outcome {
    pub adopted: Vec<String>,
    pub active: Vec<String>,
    pub bytes: u64,
    pub interruption: Option<ResourceAdoptionInterruption>,
}
pub(super) fn run<T>(
    items: &[(String, u64, T)],
    mut ready: impl FnMut(&T) -> Result<bool, ResourceMigrationError>,
    mut adopt: impl FnMut(&T) -> Result<(), ResourceMigrationError>,
) -> Result<Outcome, ResourceMigrationError> {
    let mut ids = std::collections::BTreeSet::new();
    let mut total = 0_u64;
    for (id, bytes, _) in items {
        if id.trim().is_empty() || !ids.insert(id) {
            return Err(ResourceMigrationError::Integrity(
                "接管清单包含空白或重复的资源".into(),
            ));
        }
        total = total
            .checked_add(*bytes)
            .filter(|sum| *sum <= 9_007_199_254_740_991)
            .ok_or_else(|| {
                ResourceMigrationError::Integrity("接管清单大小超出可表示范围".into())
            })?;
    }
    let mut result = Outcome::default();
    for (index, (id, bytes, value)) in items.iter().enumerate() {
        let step = ready(value).and_then(|active| {
            if active {
                Ok(false)
            } else {
                adopt(value).map(|()| true)
            }
        });
        match step {
            Ok(true) => {
                result.adopted.push(id.clone());
                result.bytes += bytes;
            }
            Ok(false) => result.active.push(id.clone()),
            Err(error) => {
                result.interruption = Some(ResourceAdoptionInterruption {
                    resource_id: id.clone(),
                    message: error.to_string(),
                    unattempted_resource_ids: items[index + 1..]
                        .iter()
                        .map(|(id, _, _)| id.clone())
                        .collect(),
                });
                break;
            }
        }
    }
    Ok(result)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn does_not_continue_after_an_adoption_error() {
        let data = tempfile::tempdir().unwrap();
        let items = vec![
            ("first".into(), 3, "first"),
            ("uncertain".into(), 3, "uncertain"),
            ("later".into(), 3, "later"),
        ];
        let result = run(
            &items,
            |_| Ok(false),
            |id| {
                if *id == "uncertain" {
                    std::fs::write(data.path().join(id), b"uncertain")?;
                    return Err(ResourceMigrationError::Integrity(
                        "activation acknowledgement failed".into(),
                    ));
                }
                std::fs::write(data.path().join(id), b"new")?;
                Ok(())
            },
        )
        .unwrap();
        assert_eq!(std::fs::read(data.path().join("first")).unwrap(), b"new");
        assert!(
            !data.path().join("later").exists(),
            "later resources must not run after an uncertain activation"
        );
        assert_eq!(result.adopted, ["first"]);
        assert_eq!(result.bytes, 3);
        let interruption = result.interruption.unwrap();
        assert_eq!(interruption.resource_id, "uncertain");
        assert_eq!(interruption.unattempted_resource_ids, ["later"]);
        assert_eq!(
            std::fs::read(data.path().join("uncertain")).unwrap(),
            b"uncertain"
        );
    }
    #[test]
    fn readiness_failure_preserves_prior_acknowledgements() {
        let items = vec![("first".into(), 3, 1), ("second".into(), 3, 2)];
        let result = run(
            &items,
            |value| {
                if *value == 2 {
                    Err(ResourceMigrationError::Busy)
                } else {
                    Ok(false)
                }
            },
            |_| Ok(()),
        );
        assert!(
            result.is_ok(),
            "an inspection failure must preserve completed acknowledgements"
        );
        let result = result.unwrap();
        assert_eq!(result.adopted, ["first"]);
        assert_eq!(result.interruption.unwrap().resource_id, "second");
    }
}

#[cfg(test)]
mod outcome_tests {
    use super::*;
    #[test]
    fn distinguishes_existing_resources_from_new_adoptions() {
        let items = vec![("existing".into(), 100, true), ("new".into(), 7, false)];
        let result = run(
            &items,
            |ready| Ok(*ready),
            |ready| {
                assert!(!*ready);
                Ok(())
            },
        )
        .unwrap();
        assert_eq!(result.adopted, ["new"]);
        assert_eq!(result.active, ["existing"]);
        assert_eq!(result.bytes, 7);
        assert!(result.interruption.is_none());
    }
    #[test]
    fn invalid_list_is_rejected_before_any_operation() {
        for items in [
            vec![("same".into(), 1, ()), ("same".into(), 1, ())],
            vec![("".into(), 1, ())],
            vec![("huge".into(), u64::MAX, ())],
        ] {
            assert!(
                run(
                    &items,
                    |_| panic!("must not read"),
                    |_| panic!("must not adopt")
                )
                .is_err()
            );
        }
    }
    #[test]
    fn first_failure_does_not_claim_any_completed_bytes() {
        let result = run(
            &[("first".into(), 9, ()), ("later".into(), 7, ())],
            |_| Err(ResourceMigrationError::Busy),
            |_| panic!("must not adopt"),
        )
        .unwrap();
        assert!(result.adopted.is_empty());
        assert!(result.active.is_empty());
        assert_eq!(result.bytes, 0);
        assert_eq!(
            result.interruption.unwrap().unattempted_resource_ids,
            ["later"]
        );
    }
}
