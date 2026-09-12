use super::*;

pub(super) fn inspect(
    input: InspectResourceMigrationInput,
) -> Result<(ResourceMigrationPreview, Vec<VerifiedCandidate>), ResourceMigrationError> {
    let sources = candidate_sources(input.source_path.as_deref(), input.source_kind.as_deref())?;
    let (verified, rejected) = inspect_sources(&sources)?;
    let mut verified_resource_ids = verified
        .iter()
        .map(|candidate| candidate.public.resource_id.clone())
        .collect::<Vec<_>>();
    verified_resource_ids.sort();
    verified_resource_ids.dedup();
    let reusable_bytes = verified
        .iter()
        .map(|candidate| candidate.public.reusable_bytes)
        .sum();
    let mut candidates = verified
        .iter()
        .map(|candidate| candidate.public.clone())
        .chain(rejected.iter().cloned())
        .collect::<Vec<_>>();
    candidates.sort_by(|left, right| {
        left.resource_id
            .cmp(&right.resource_id)
            .then(left.state.cmp(&right.state))
            .then(left.resource_path.cmp(&right.resource_path))
    });
    let configuration = local_resources::configuration_snapshot();
    let mut preview = ResourceMigrationPreview {
        resource_root: configuration
            .as_ref()
            .map(|value| value.resource_root.clone()),
        plan_fingerprint: String::new(),
        sources: sources
            .into_iter()
            .map(|source| ResourceMigrationSource {
                kind: source.kind,
                path: path_string(&source.root),
            })
            .collect(),
        candidates,
        verified_resource_ids,
        reusable_bytes,
        rejected_count: rejected.len(),
    };
    preview.plan_fingerprint = fingerprint(&configuration, &preview, &verified)?;
    Ok((preview, verified))
}

pub(super) fn fingerprint(
    configuration: &Option<LocalResourceConfiguration>,
    preview: &ResourceMigrationPreview,
    verified: &[VerifiedCandidate],
) -> Result<String, ResourceMigrationError> {
    let candidates = preview
        .candidates
        .iter()
        .map(|candidate| {
            (
                &candidate.source_kind,
                &candidate.source_root,
                &candidate.resource_id,
                &candidate.resource_path,
                &candidate.state,
                candidate.reusable_bytes,
            )
        })
        .collect::<Vec<_>>();
    let payloads = verified
        .iter()
        .map(|candidate| (&candidate.definition, &candidate.files))
        .collect::<Vec<_>>();
    Ok(crate::cleanup_confirmation::fingerprint(
        "resource-adoption-v1",
        configuration,
        &(
            &preview.resource_root,
            &preview.sources,
            candidates,
            &preview.verified_resource_ids,
            preview.reusable_bytes,
            preview.rejected_count,
        ),
        &payloads,
    )?)
}
pub(super) fn verify(expected: &str, actual: &str) -> Result<(), ResourceMigrationError> {
    if expected.len() != 64
        || !expected.bytes().all(|byte| byte.is_ascii_hexdigit())
        || expected != actual
    {
        return Err(ResourceMigrationError::AdoptionPlanChanged);
    }
    Ok(())
}
pub(super) fn verify_files(
    expected: &[ReceiptFile],
    actual: &[ReceiptFile],
) -> Result<(), ResourceMigrationError> {
    if expected != actual {
        return Err(ResourceMigrationError::AdoptionPlanChanged);
    }
    Ok(())
}
