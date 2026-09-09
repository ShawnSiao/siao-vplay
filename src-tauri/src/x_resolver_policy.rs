use crate::{remote_media, youtube_media::YouTubeMediaError};
use serde::Serialize;
use url::Url;

const DEFAULT_RESOLVER_BASE: &str = "https://api.fxtwitter.com/status/";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(schemars::JsonSchema))]
pub struct ResolverDisclosure {
    pub receiver: String,
    pub resolver_base: String,
}

pub fn disclosure() -> Result<ResolverDisclosure, YouTubeMediaError> {
    let configured = std::env::var("SIAOVPLAY_X_PUBLIC_RESOLVER")
        .unwrap_or_else(|_| DEFAULT_RESOLVER_BASE.to_owned());
    describe(&configured)
}
fn describe(configured: &str) -> Result<ResolverDisclosure, YouTubeMediaError> {
    // The local disclosure never resolves DNS or contacts the receiver.
    let mut base = remote_media::validate_url_syntax(configured)?;
    base.set_query(None);
    base.set_fragment(None);
    Ok(ResolverDisclosure {
        receiver: base.origin().ascii_serialization(),
        resolver_base: base.to_string(),
    })
}

pub(crate) fn authorized_url(
    authorized_base: Option<&str>,
    status_id: &str,
) -> Result<Option<Url>, YouTubeMediaError> {
    let Some(authorized) = authorized_base else {
        return Ok(None);
    };
    target(&disclosure()?, authorized, status_id).map(Some)
}
fn target(
    current: &ResolverDisclosure,
    authorized: &str,
    status_id: &str,
) -> Result<Url, YouTubeMediaError> {
    if authorized != current.resolver_base {
        return Err(YouTubeMediaError::ResolverConsentChanged);
    }
    let mut url = remote_media::validate_url_syntax(authorized)?;
    url.path_segments_mut()
        .map_err(|_| YouTubeMediaError::ResolverConsentChanged)?
        .pop_if_empty()
        .push(status_id);
    Ok(url)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn no_consent_has_no_resolver_target() {
        assert!(authorized_url(None, "123").unwrap().is_none());
    }
    #[test]
    fn a_changed_receiver_or_base_path_invalidates_confirmation() {
        let current = describe("https://resolver.example/status/?unused=true#unused").unwrap();
        assert_eq!(current.receiver, "https://resolver.example");
        assert!(target(&current, "https://different.example/status/", "123").is_err());
        assert!(target(&current, "https://resolver.example/other/", "123").is_err());
        assert_eq!(
            target(&current, &current.resolver_base, "123")
                .unwrap()
                .as_str(),
            "https://resolver.example/status/123"
        );
        assert!(describe("https://user:password@resolver.example/status/").is_err());
        assert!(describe("http://resolver.example/status/").is_err());
    }
}
