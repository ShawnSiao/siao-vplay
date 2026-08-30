use serde_json::Value;
use url::Url;

use crate::{remote_media, youtube_media::YouTubeMediaError};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum PublicVideoSource {
    YouTube,
    X,
}

impl PublicVideoSource {
    pub(crate) fn detect_and_validate(input: &str) -> Result<(Url, Self), YouTubeMediaError> {
        let parsed = parse_https_url(input)?;
        let host = normalized_host(&parsed)?;
        let source = if is_youtube_host(&host) {
            Self::YouTube
        } else if is_x_host(&host) {
            Self::X
        } else {
            return Err(YouTubeMediaError::UnsupportedUrl);
        };
        source.validate_page_url(parsed.as_str())?;
        remote_media::validate_public_https_url(parsed.as_str())?;
        Ok((parsed, source))
    }

    pub(crate) fn validate_metadata(
        self,
        original: &Url,
        metadata: &Value,
    ) -> Result<Url, YouTubeMediaError> {
        let extractor = metadata
            .get("extractor_key")
            .or_else(|| metadata.get("extractor"))
            .and_then(Value::as_str)
            .unwrap_or_default();
        let expected_extractor = match self {
            Self::YouTube => "youtube",
            Self::X => "twitter",
        };
        if !extractor.eq_ignore_ascii_case(expected_extractor) {
            return Err(YouTubeMediaError::UncertainMedia);
        }

        match metadata.get("availability").and_then(Value::as_str) {
            Some("public") => {}
            Some("private" | "premium_only" | "subscriber_only" | "needs_auth") => {
                return Err(YouTubeMediaError::Restricted);
            }
            None if self == Self::X => {}
            _ => return Err(YouTubeMediaError::UncertainMedia),
        }
        if self == Self::X
            && metadata
                .get("age_limit")
                .and_then(Value::as_u64)
                .is_some_and(|age| age > 0)
        {
            return Err(YouTubeMediaError::Restricted);
        }

        let webpage_url = required_text(metadata, "webpage_url", "规范页面 URL")?;
        let webpage_url = self.validate_page_url(&webpage_url)?;
        if self == Self::X {
            let original_status = x_status_id(original).ok_or(YouTubeMediaError::UnsupportedUrl)?;
            let webpage_status =
                x_status_id(&webpage_url).ok_or(YouTubeMediaError::UncertainMedia)?;
            let display_id = required_text(metadata, "display_id", "帖子标识")?;
            if original_status != webpage_status || original_status != display_id {
                return Err(YouTubeMediaError::UncertainMedia);
            }
        }
        Ok(webpage_url)
    }

    pub(crate) fn fallback_title(self) -> &'static str {
        match self {
            Self::YouTube => "YouTube 视频",
            Self::X => "X 视频",
        }
    }

    pub(crate) fn validate_page_url(self, input: &str) -> Result<Url, YouTubeMediaError> {
        let url = parse_https_url(input)?;
        let host = normalized_host(&url)?;
        let valid = match self {
            Self::YouTube => validate_youtube_shape(&url, &host)?,
            Self::X => is_x_host(&host) && x_status_id(&url).is_some(),
        };
        valid
            .then_some(url)
            .ok_or(YouTubeMediaError::UnsupportedUrl)
    }
}

fn parse_https_url(input: &str) -> Result<Url, YouTubeMediaError> {
    let url = Url::parse(input.trim()).map_err(|_| YouTubeMediaError::UnsupportedUrl)?;
    if url.scheme() != "https" || !url.username().is_empty() || url.password().is_some() {
        return Err(YouTubeMediaError::UnsupportedUrl);
    }
    Ok(url)
}

fn normalized_host(url: &Url) -> Result<String, YouTubeMediaError> {
    url.host_str()
        .map(|host| host.trim_end_matches('.').to_ascii_lowercase())
        .ok_or(YouTubeMediaError::UnsupportedUrl)
}

fn is_youtube_host(host: &str) -> bool {
    matches!(
        host,
        "youtube.com" | "www.youtube.com" | "m.youtube.com" | "youtu.be"
    )
}

fn is_x_host(host: &str) -> bool {
    matches!(
        host,
        "x.com"
            | "www.x.com"
            | "m.x.com"
            | "mobile.x.com"
            | "twitter.com"
            | "www.twitter.com"
            | "m.twitter.com"
            | "mobile.twitter.com"
    )
}

fn validate_youtube_shape(url: &Url, host: &str) -> Result<bool, YouTubeMediaError> {
    if !is_youtube_host(host) {
        return Ok(false);
    }
    if url.query_pairs().any(|(key, _)| key == "list")
        || url.path().eq_ignore_ascii_case("/playlist")
    {
        return Err(YouTubeMediaError::PlaylistNotAllowed);
    }
    if host == "youtu.be" {
        return Ok(url
            .path_segments()
            .and_then(|mut segments| segments.next())
            .is_some_and(|segment| !segment.is_empty()));
    }
    if url.path().eq_ignore_ascii_case("/watch") {
        return Ok(url
            .query_pairs()
            .any(|(key, value)| key == "v" && !value.is_empty()));
    }
    let mut segments = url.path_segments().into_iter().flatten();
    Ok(matches!(segments.next(), Some("shorts" | "live"))
        && segments.next().is_some_and(|segment| !segment.is_empty()))
}

fn x_status_id(url: &Url) -> Option<&str> {
    let segments = url.path_segments()?.collect::<Vec<_>>();
    let (id_index, tail_index) = match segments.as_slice() {
        ["statuses", id, ..] if is_numeric(id) => (1, 2),
        ["i", "web", "status", id, ..] if is_numeric(id) => (3, 4),
        [account, "status", id, ..] if !account.is_empty() && is_numeric(id) => (2, 3),
        _ => return None,
    };
    let tail = &segments[tail_index..];
    if tail.is_empty() || matches!(tail, ["video" | "photo", index] if is_numeric(index)) {
        Some(segments[id_index])
    } else {
        None
    }
}

fn is_numeric(value: &str) -> bool {
    !value.is_empty() && value.bytes().all(|byte| byte.is_ascii_digit())
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

    fn x_metadata() -> Value {
        serde_json::json!({
            "extractor_key": "Twitter",
            "display_id": "1234567890",
            "webpage_url": "https://x.com/openai/status/1234567890",
            "age_limit": 0
        })
    }

    #[test]
    fn accepts_supported_x_status_shapes_and_rejects_other_pages() {
        for url in [
            "https://x.com/openai/status/1234567890",
            "https://www.twitter.com/openai/status/1234567890/video/1",
            "https://mobile.twitter.com/i/web/status/1234567890",
            "https://twitter.com/statuses/1234567890",
        ] {
            let parsed = Url::parse(url).unwrap();
            assert_eq!(x_status_id(&parsed), Some("1234567890"));
        }
        for url in [
            "https://x.com/openai",
            "https://x.com/home",
            "https://x.com/openai/status/not-a-number",
            "https://x.com/openai/status/1234567890/likes",
        ] {
            assert!(x_status_id(&Url::parse(url).unwrap()).is_none());
        }
    }

    #[test]
    fn accepts_public_x_metadata_without_cookie_availability() {
        let original = Url::parse("https://x.com/openai/status/1234567890").unwrap();
        let webpage = PublicVideoSource::X
            .validate_metadata(&original, &x_metadata())
            .unwrap();

        assert_eq!(webpage, original);
    }

    #[test]
    fn rejects_restricted_external_or_changed_x_metadata() {
        let original = Url::parse("https://x.com/openai/status/1234567890").unwrap();

        let mut restricted = x_metadata();
        restricted["age_limit"] = Value::Number(18.into());
        assert!(matches!(
            PublicVideoSource::X.validate_metadata(&original, &restricted),
            Err(YouTubeMediaError::Restricted)
        ));

        let mut external = x_metadata();
        external["extractor_key"] = Value::String("Youtube".to_owned());
        assert!(matches!(
            PublicVideoSource::X.validate_metadata(&original, &external),
            Err(YouTubeMediaError::UncertainMedia)
        ));

        let mut changed = x_metadata();
        changed["display_id"] = Value::String("9999999999".to_owned());
        assert!(matches!(
            PublicVideoSource::X.validate_metadata(&original, &changed),
            Err(YouTubeMediaError::UncertainMedia)
        ));
    }
}
