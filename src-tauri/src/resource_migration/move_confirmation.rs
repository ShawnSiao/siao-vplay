use super::{
    LocalResourceConfiguration, LocalResourceMovePlan, ReceiptFile, ResourceMigrationError,
};

pub(super) fn fingerprint(
    configuration: &LocalResourceConfiguration,
    plan: &LocalResourceMovePlan,
    files: &[ReceiptFile],
) -> Result<String, ResourceMigrationError> {
    // Free space is checked again during execution; unrelated disk activity must
    // not invalidate consent. Contents, destinations and configuration do.
    Ok(crate::cleanup_confirmation::fingerprint(
        "resource-move-v1",
        configuration,
        &(
            &plan.previous_root,
            &plan.selected_parent,
            &plan.resource_root,
            plan.cross_volume,
            plan.destination_exists,
        ),
        &files,
    )?)
}
pub(super) fn verify(expected: &str, actual: &str) -> Result<(), ResourceMigrationError> {
    if expected.len() != 64
        || !expected.bytes().all(|byte| byte.is_ascii_hexdigit())
        || expected != actual
    {
        return Err(ResourceMigrationError::PlanChanged);
    }
    Ok(())
}

#[cfg(test)]
thread_local! { pub(super) static BEFORE_COPY: std::cell::RefCell<Option<Box<dyn FnOnce()>>> = const { std::cell::RefCell::new(None) }; }
#[cfg(test)]
pub(super) fn run_before_copy() {
    BEFORE_COPY.with(|hook| {
        if let Some(mutate) = hook.borrow_mut().take() {
            mutate();
        }
    });
}
