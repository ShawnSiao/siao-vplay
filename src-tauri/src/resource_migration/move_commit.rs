use super::ResourceMigrationError;

pub(super) fn switch_configuration<T>(
    previous: &T,
    next: &T,
    mut persist: impl FnMut(&T) -> Result<(), ResourceMigrationError>,
    mut rebind: impl FnMut() -> Result<(), ResourceMigrationError>,
) -> Result<(), ResourceMigrationError> {
    if let Err(error) = persist(next).and_then(|()| rebind()) {
        // Persistence may have succeeded before status inspection failed.
        // Attempt both repairs: a failed persistence acknowledgement does not
        // prove the in-memory configuration is unchanged.
        let restored = persist(previous);
        let rebound = rebind();
        if let Err(recovery) = restored.and(rebound) {
            return Err(ResourceMigrationError::Integrity(format!(
                "移动未完成且恢复原保存位置失败。两个资源目录均保留，请重启后检查保存位置。移动错误：{error}；恢复错误：{recovery}"
            )));
        }
        return Err(error);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;

    #[test]
    fn binding_failure_restores_persisted_root_and_rebinds_old_resources() {
        let current = RefCell::new("old");
        let bound = RefCell::new(Vec::new());
        let result = switch_configuration(
            &"old",
            &"new",
            |root| {
                *current.borrow_mut() = root;
                Ok(())
            },
            || {
                let root = *current.borrow();
                bound.borrow_mut().push(root);
                if root == "new" {
                    Err(ResourceMigrationError::Busy)
                } else {
                    Ok(())
                }
            },
        );
        assert!(result.is_err());
        assert_eq!(*current.borrow(), "old");
        assert_eq!(*bound.borrow(), vec!["new", "old"]);
    }

    #[test]
    fn failure_after_persisting_is_also_rolled_back() {
        let current = RefCell::new("old");
        let result = switch_configuration(
            &"old",
            &"new",
            |root| {
                *current.borrow_mut() = root;
                if *root == "new" {
                    Err(ResourceMigrationError::Busy)
                } else {
                    Ok(())
                }
            },
            || Ok(()),
        );
        assert!(result.is_err());
        assert_eq!(*current.borrow(), "old");
    }

    #[test]
    fn failed_rollback_is_reported_as_requiring_recovery() {
        let error = switch_configuration(
            &"old",
            &"new",
            |_| Err(ResourceMigrationError::Busy),
            || Ok(()),
        )
        .unwrap_err();
        assert!(error.to_string().contains("恢复原保存位置失败"));
    }
}
