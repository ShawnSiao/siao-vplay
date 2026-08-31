use serde_json::Value;
use url::Url;

use crate::{remote_media, youtube_media::YouTubeMediaError};

pub(crate) fn validate_public_video_page(input: &str) -> Result<Url, YouTubeMediaError> {
    let url = validate_page_syntax(input)?;
    remote_media::validate_public_https_url(url.as_str())?;
    Ok(url)
}

pub(crate) fn validate_generic_metadata(
    metadata: &Value,
) -> Result<(Url, String), YouTubeMediaError> {
    if metadata
        .get("availability")
        .and_then(Value::as_str)
        .is_some_and(|value| {
            matches!(
                value,
                "private" | "premium_only" | "subscriber_only" | "needs_auth"
            )
        })
    {
        return Err(YouTubeMediaError::Restricted);
    }
    let webpage_url = required_text(metadata, "webpage_url", "规范页面 URL")?;
    let webpage_url = validate_public_video_page(&webpage_url)?;
    let extractor = metadata
        .get("extractor_key")
        .or_else(|| metadata.get("extractor"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| YouTubeMediaError::MetadataInvalid("缺少站点提取器".to_owned()))?
        .to_owned();
    Ok((webpage_url, extractor))
}

fn validate_page_syntax(input: &str) -> Result<Url, YouTubeMediaError> {
    let url = Url::parse(input.trim()).map_err(|_| YouTubeMediaError::UnsupportedUrl)?;
    if url.scheme() != "https"
        || !url.username().is_empty()
        || url.password().is_some()
        || url.host_str().is_none()
    {
        return Err(YouTubeMediaError::UnsupportedUrl);
    }
    Ok(url)
}

fn required_text(metadata: &Value, key: &str, label: &str) -> Result<String, YouTubeMediaError> {
    metadata
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
        .ok_or_else(|| YouTubeMediaError::MetadataInvalid(format!("缺少{label}")))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generic_page_syntax_accepts_public_platform_shapes_without_site_rules() {
        for url in [
            "https://x.com/i/status/1234567890",
            "https://x.com/openai/status/not-a-number/custom-tail",
            "https://twitter.com/home",
            "https://www.youtube.com/watch?v=jNQXAC9IVRw&list=PL123",
            "https://video.example/watch/anything",
        ] {
            assert!(validate_page_syntax(url).is_ok(), "{url}");
        }
        for url in [
            "http://x.com/openai/status/1234567890",
            "https://name:secret@x.com/openai/status/1234567890",
            "not a URL",
        ] {
            assert!(validate_page_syntax(url).is_err(), "{url}");
        }
    }

    #[test]
    fn generic_metadata_accepts_nonmatching_extractor_ids_and_age_fields() {
        let metadata = serde_json::json!({
            "extractor_key": "Generic",
            "display_id": "changed-page-id",
            "webpage_url": "https://1.1.1.1/watch/canonical",
            "age_limit": 18
        });
        let (webpage_url, extractor) = validate_generic_metadata(&metadata).unwrap();

        assert_eq!(webpage_url.as_str(), "https://1.1.1.1/watch/canonical");
        assert_eq!(extractor, "Generic");
    }

    #[test]
    fn generic_metadata_still_rejects_known_access_restrictions() {
        for availability in ["private", "premium_only", "subscriber_only", "needs_auth"] {
            let metadata = serde_json::json!({
                "extractor_key": "Twitter",
                "webpage_url": "https://x.com/example/status/1234567890",
                "availability": availability
            });
            assert!(matches!(
                validate_generic_metadata(&metadata),
                Err(YouTubeMediaError::Restricted)
            ));
        }
    }
}
