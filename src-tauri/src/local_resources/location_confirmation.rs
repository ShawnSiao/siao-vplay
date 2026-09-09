use super::*;
pub fn configure(
    input: &ConfigureLocalResourceRootInput,
) -> Result<LocalResourceStatus, LocalResourceError> {
    let _maintenance = crate::resource_leases::maintain_all()?;
    with_manager_write(|manager| {
        manager.configure_confirmed_location(
            &input.parent_path,
            &input.resource_root,
            &input.plan_fingerprint,
            input.confirmed,
        )
    })
}
impl LocalResourceManager {
    pub(super) fn plan_location(
        &self,
        parent: &str,
    ) -> Result<LocalResourceLocationPlan, LocalResourceError> {
        let (parent, root) = resolve_selected_location(parent)?;
        self.plan_resolved_location(parent, root)
    }
    fn plan_resolved_location(
        &self,
        parent: PathBuf,
        root: PathBuf,
    ) -> Result<LocalResourceLocationPlan, LocalResourceError> {
        use sha2::{Digest, Sha256};
        let selected_parent = path_string(&parent);
        let resource_root = path_string(&root);
        let resource_root_exists = root.is_dir();
        let payload = serde_json::to_vec(&(
            "resource-location-v1",
            &self.configuration,
            &selected_parent,
            &resource_root,
            resource_root_exists,
        ))?;
        Ok(LocalResourceLocationPlan {
            plan_fingerprint: format!("{:x}", Sha256::digest(payload)),
            selected_parent,
            resource_root,
            parent_exists: true,
            resource_root_exists,
            free_space_bytes: available_space(&parent),
            confirmation_required: true,
        })
    }
    fn configure_confirmed_location(
        &mut self,
        parent: &str,
        expected_root: &str,
        fingerprint: &str,
        confirmed: bool,
    ) -> Result<LocalResourceStatus, LocalResourceError> {
        if !confirmed {
            return Err(LocalResourceError::ConfirmationRequired);
        }
        let parent = validate_parent(parent)?;
        let root = parent.join(RESOURCE_DIRECTORY_NAME);
        let plan = self.plan_resolved_location(parent.clone(), root.clone())?;
        if fingerprint != plan.plan_fingerprint || expected_root != plan.resource_root {
            return Err(LocalResourceError::LocationPlanChanged);
        }
        self.configure_resolved_location(parent, root)
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn nested_same_named_directories_preserve_the_reviewed_root() {
        let data = tempfile::tempdir().unwrap();
        let selected = tempfile::tempdir().unwrap();
        let nested = selected
            .path()
            .join(RESOURCE_DIRECTORY_NAME)
            .join(RESOURCE_DIRECTORY_NAME);
        fs::create_dir_all(&nested).unwrap();
        let mut manager = LocalResourceManager::load(data.path()).unwrap();
        let plan = manager.plan_location(nested.to_str().unwrap()).unwrap();
        let status = manager
            .configure_confirmed_location(
                &plan.selected_parent,
                &plan.resource_root,
                &plan.plan_fingerprint,
                true,
            )
            .unwrap();
        assert_eq!(
            status.resource_root.as_deref(),
            Some(plan.resource_root.as_str())
        );
    }
    #[test]
    fn changed_configuration_or_target_state_requires_new_confirmation() {
        let data = tempfile::tempdir().unwrap();
        let selected = tempfile::tempdir().unwrap();
        let mut manager = LocalResourceManager::load(data.path()).unwrap();
        let plan = manager
            .plan_location(selected.path().to_str().unwrap())
            .unwrap();
        fs::create_dir(selected.path().join(RESOURCE_DIRECTORY_NAME)).unwrap();
        assert!(matches!(
            manager.configure_confirmed_location(
                &plan.selected_parent,
                &plan.resource_root,
                &plan.plan_fingerprint,
                true
            ),
            Err(LocalResourceError::LocationPlanChanged)
        ));
        assert!(!manager.config_path.exists());
        let fresh = manager.plan_location(&plan.selected_parent).unwrap();
        let status = manager
            .configure_confirmed_location(
                &fresh.selected_parent,
                &fresh.resource_root,
                &fresh.plan_fingerprint,
                true,
            )
            .unwrap();
        assert_eq!(
            status.resource_root.as_deref(),
            Some(fresh.resource_root.as_str())
        );
        let saved = fs::read(&manager.config_path).unwrap();
        assert!(matches!(
            manager.configure_confirmed_location(
                &fresh.selected_parent,
                &fresh.resource_root,
                &fresh.plan_fingerprint,
                true
            ),
            Err(LocalResourceError::LocationPlanChanged)
        ));
        assert_eq!(fs::read(&manager.config_path).unwrap(), saved);
    }
    #[test]
    fn missing_snapshot_input_is_rejected() {
        assert!(
            serde_json::from_value::<ConfigureLocalResourceRootInput>(
                serde_json::json!({"parentPath":"W:/fixture", "confirmed":true})
            )
            .is_err()
        );
    }
    #[test]
    fn changed_confirmation_target_is_rejected_without_writing() {
        let data = tempfile::tempdir().unwrap();
        let selected = tempfile::tempdir().unwrap();
        let other = tempfile::tempdir().unwrap();
        let mut manager = LocalResourceManager::load(data.path()).unwrap();
        let plan = manager
            .plan_location(selected.path().to_str().unwrap())
            .unwrap();
        let result = manager.configure_confirmed_location(
            other.path().to_str().unwrap(),
            &plan.resource_root,
            &plan.plan_fingerprint,
            true,
        );
        assert!(
            result.is_err(),
            "a different target must not replace the reviewed location"
        );
        assert!(!other.path().join(RESOURCE_DIRECTORY_NAME).exists());
        assert!(manager.configuration.is_none());
        assert!(!manager.config_path.exists());
    }
}
