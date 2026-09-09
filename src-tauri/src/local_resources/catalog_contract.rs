use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(schemars::JsonSchema))]
pub struct LocalResourceCatalog {
    #[cfg_attr(test, schemars(range(min = 1, max = 1)))]
    pub schema_version: u32,
    pub product_id: String,
    pub updated_at: String,
    pub package_profile: String,
    pub bundle_policy: BundlePolicy,
    pub capabilities: Vec<CapabilityDefinition>,
    pub profiles: Vec<ProfileDefinition>,
    pub resources: Vec<ResourceDefinition>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(schemars::JsonSchema))]
pub struct BundlePolicy {
    #[cfg_attr(test, schemars(range(min = 0, max = 9007199254740991_u64)))]
    pub maximum_exception_bytes: u64,
    pub allowlisted_resource_ids: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(schemars::JsonSchema))]
pub struct CapabilityDefinition {
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub resource_ids: Vec<String>,
    #[serde(default)]
    pub profile_ids: Vec<String>,
    #[serde(default)]
    pub requires_capability_ids: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(schemars::JsonSchema))]
pub struct ProfileDefinition {
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub resource_ids: Vec<String>,
    pub recommended: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(schemars::JsonSchema))]
pub struct ResourceDefinition {
    pub id: String,
    pub version: String,
    pub platform: String,
    pub kind: String,
    pub bundled: bool,
    #[serde(default)]
    #[cfg_attr(test, schemars(range(min = 0, max = 9007199254740991_u64)))]
    pub installed_size: Option<u64>,
    #[serde(default)]
    #[cfg_attr(test, schemars(range(min = 0, max = 9007199254740991_u64)))]
    pub expected_download_size: Option<u64>,
    pub license: String,
    pub source_page: String,
    #[serde(default)]
    pub artifact: Option<ResourceArtifact>,
    #[serde(default)]
    pub entrypoints: BTreeMap<String, String>,
    pub health_check: String,
    #[serde(default)]
    pub source_commit: Option<String>,
    #[serde(default)]
    pub patch_sha256: Option<String>,
    #[serde(default)]
    pub requires: Option<String>,
    #[serde(default)]
    pub distribution: Option<ResourceDistribution>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(schemars::JsonSchema))]
pub struct ResourceArtifact {
    pub url: String,
    #[cfg_attr(test, schemars(range(min = 0, max = 9007199254740991_u64)))]
    pub size: u64,
    pub sha256: String,
    pub format: String,
    #[serde(default)]
    #[cfg_attr(test, schemars(range(min = 0, max = 4294967295_u64)))]
    pub strip_components: Option<u32>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(schemars::JsonSchema))]
pub struct ResourceDistribution {
    pub status: String,
}
