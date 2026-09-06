use std::{io::Read, time::Duration};

use reqwest::{
    Proxy,
    blocking::Client,
    header::{CONTENT_LENGTH, CONTENT_TYPE, USER_AGENT},
};
use serde::Deserialize;
use url::Url;

use crate::{
    public_connect_proxy::SafeConnectProxy,
    public_video_source::validate_public_video_page,
    remote_media::{self, RemoteMediaError},
    youtube_media::YouTubeMediaError,
};

const RESOLVER_RESPONSE_LIMIT: u64 = 2 * 1024 * 1024;
const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);
const USER_AGENT_VALUE: &str = concat!("SiaoVPlay/", env!("CARGO_PKG_VERSION"), " public-X-resolver");

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct ResolvedXVideo {
    pub webpage_url: Url,
    pub media_url: Url,
    pub video_id: String,
    pub title: String,
    pub duration_seconds: f64,
    pub file_size_bytes: Option<u64>,
}

#[derive(Debug, Deserialize)]
struct ResolverEnvelope {
    code: u16,
    tweet: Option<ResolverTweet>,
}

#[derive(Debug, Deserialize)]
struct ResolverTweet {
    url: String,
    text: String,
    media: Option<ResolverMedia>,
}

#[derive(Debug, Deserialize)]
struct ResolverMedia {
    #[serde(default)]
    videos: Vec<ResolverVideo>,
}

#[derive(Debug, Deserialize)]
struct ResolverVideo {
    id: String,
    url: Option<String>,
    duration: Option<f64>,
    #[serde(default)]
    formats: Vec<ResolverFormat>,
}

#[derive(Debug, Deserialize)]
struct ResolverFormat {
    url: String,
    bitrate: Option<u64>,
    container: Option<String>,
}

pub(crate) fn resolve(original: &Url, authorized_resolver_base: Option<&str>) -> Result<Option<ResolvedXVideo>, YouTubeMediaError> {
    let Some(request) = XStatusRequest::parse(original)? else {
        return Ok(None);
    };
    let Some(resolver_url) = crate::x_resolver_policy::authorized_url(authorized_resolver_base, &request.status_id)? else { return Ok(None); };
    let resolver_url = remote_media::validate_public_https_url(resolver_url.as_str())?;
    let bytes = fetch_limited_json(&resolver_url)?;
    let envelope: ResolverEnvelope = serde_json::from_slice(&bytes)
        .map_err(|_| metadata_error("X 公开解析服务返回了无效数据"))?;
    if envelope.code != 200 {
        return Err(metadata_error("X 公开解析服务未返回该帖子"));
    }
    let tweet = envelope
        .tweet
        .ok_or_else(|| metadata_error("X 公开解析服务未返回帖子内容"))?;
    let media = tweet
        .media
        .ok_or_else(|| metadata_error("该 X 帖子没有可下载的视频"))?;
    let video = media
        .videos
        .get(request.video_index - 1)
        .ok_or_else(|| metadata_error("该 X 帖子没有对应序号的视频"))?;
    let media_url =
        best_mp4_url(video).ok_or_else(|| metadata_error("该 X 视频没有公开 MP4 地址"))?;
    let media_url = remote_media::validate_public_https_url(media_url)?;
    let webpage_url = validate_public_video_page(&tweet.url)?;
    let returned_request = XStatusRequest::parse(&webpage_url)?
        .ok_or_else(|| metadata_error("X 公开解析服务返回了不匹配的页面"))?;
    if returned_request.status_id != request.status_id {
        return Err(metadata_error("X 公开解析服务返回了不匹配的帖子"));
    }
    let duration_seconds = video
        .duration
        .filter(|value| value.is_finite() && *value > 0.0)
        .ok_or_else(|| metadata_error("无法确认 X 视频时长"))?;
    let file_size_bytes = public_content_length(&media_url)?;
    Ok(Some(ResolvedXVideo {
        webpage_url,
        media_url,
        video_id: video.id.trim().to_owned(),
        title: tweet.text.trim().to_owned(),
        duration_seconds,
        file_size_bytes,
    }))
}

fn best_mp4_url(video: &ResolverVideo) -> Option<&str> {
    video
        .formats
        .iter()
        .filter(|format| {
            format.container.as_deref() == Some("mp4")
                || format
                    .url
                    .split('?')
                    .next()
                    .is_some_and(|url| url.ends_with(".mp4"))
        })
        .max_by_key(|format| format.bitrate.unwrap_or_default())
        .map(|format| format.url.as_str())
        .or(video.url.as_deref())
}

#[cfg(test)]
fn resolver_url_from_base(configured: &str, status_id: &str) -> Result<Url, YouTubeMediaError> {
    let mut base = remote_media::validate_public_https_url(configured)?;
    base.set_query(None);
    base.set_fragment(None);
    base.path_segments_mut()
        .map_err(|_| metadata_error("X 公开解析服务地址无效"))?
        .pop_if_empty()
        .push(status_id);
    Ok(base)
}

fn fetch_limited_json(url: &Url) -> Result<Vec<u8>, YouTubeMediaError> {
    let (client, _proxy) = safe_client()?;
    let response = client
        .get(url.clone())
        .header(USER_AGENT, USER_AGENT_VALUE)
        .send()
        .map_err(request_error)?;
    if !response.status().is_success() {
        return Err(metadata_error("X 公开解析服务暂时无法读取该帖子"));
    }
    if response
        .content_length()
        .is_some_and(|length| length > RESOLVER_RESPONSE_LIMIT)
    {
        return Err(metadata_error("X 公开解析服务返回的数据过大"));
    }
    let mut bytes = Vec::new();
    response
        .take(RESOLVER_RESPONSE_LIMIT + 1)
        .read_to_end(&mut bytes)?;
    if bytes.len() as u64 > RESOLVER_RESPONSE_LIMIT {
        return Err(metadata_error("X 公开解析服务返回的数据过大"));
    }
    Ok(bytes)
}

fn public_content_length(url: &Url) -> Result<Option<u64>, YouTubeMediaError> {
    let (client, _proxy) = safe_client()?;
    let response = client
        .head(url.clone())
        .header(USER_AGENT, USER_AGENT_VALUE)
        .send()
        .map_err(request_error)?;
    if !response.status().is_success() {
        return Ok(None);
    }
    let content_type = response
        .headers()
        .get(CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .map(str::trim)
        .filter(|value| !value.is_empty());
    if content_type.is_some_and(|value| !value.to_ascii_lowercase().starts_with("video/")) {
        return Err(metadata_error("X 视频媒体地址未返回视频内容"));
    }
    Ok(response
        .headers()
        .get(CONTENT_LENGTH)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse().ok()))
}

fn safe_client() -> Result<(Client, SafeConnectProxy), YouTubeMediaError> {
    let proxy = SafeConnectProxy::start()?;
    let client = Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .proxy(Proxy::all(proxy.url()).map_err(request_error)?)
        .connect_timeout(REQUEST_TIMEOUT)
        .timeout(REQUEST_TIMEOUT)
        .build()
        .map_err(request_error)?;
    Ok((client, proxy))
}

fn request_error(error: impl ToString) -> YouTubeMediaError {
    YouTubeMediaError::Network(RemoteMediaError::Request(error.to_string()))
}

fn metadata_error(message: &str) -> YouTubeMediaError {
    YouTubeMediaError::MetadataInvalid(message.to_owned())
}

#[derive(Debug, PartialEq)]
struct XStatusRequest {
    status_id: String,
    video_index: usize,
}

impl XStatusRequest {
    fn parse(url: &Url) -> Result<Option<Self>, YouTubeMediaError> {
        let host = url
            .host_str()
            .map(|value| value.trim_end_matches('.').to_ascii_lowercase());
        if !host.as_deref().is_some_and(is_x_host) {
            return Ok(None);
        }
        let segments = url
            .path_segments()
            .into_iter()
            .flatten()
            .collect::<Vec<_>>();
        let Some(status_position) = segments
            .iter()
            .position(|segment| matches!(*segment, "status" | "statuses"))
        else {
            return Ok(None);
        };
        let status_id = segments
            .get(status_position + 1)
            .filter(|value| !value.is_empty() && value.bytes().all(|byte| byte.is_ascii_digit()))
            .ok_or(YouTubeMediaError::UnsupportedUrl)?;
        let video_index = match &segments[(status_position + 2)..] {
            [] => 1,
            ["video", index] => index
                .parse::<usize>()
                .ok()
                .filter(|index| *index > 0)
                .ok_or(YouTubeMediaError::UnsupportedUrl)?,
            _ => return Err(YouTubeMediaError::UnsupportedUrl),
        };
        Ok(Some(Self {
            status_id: (*status_id).to_owned(),
            video_index,
        }))
    }
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_share_and_indexed_x_status_urls() {
        assert_eq!(
            XStatusRequest::parse(
                &Url::parse("https://x.com/example/status/2062110003566362779?s=20").unwrap()
            )
            .unwrap()
            .unwrap(),
            XStatusRequest {
                status_id: "2062110003566362779".to_owned(),
                video_index: 1,
            }
        );
        assert_eq!(
            XStatusRequest::parse(
                &Url::parse("https://twitter.com/example/status/2062110003566362779/video/2")
                    .unwrap()
            )
            .unwrap()
            .unwrap()
            .video_index,
            2
        );
    }

    #[test]
    fn ignores_non_x_pages_and_rejects_invalid_x_suffixes() {
        assert!(
            XStatusRequest::parse(&Url::parse("https://example.com/status/123").unwrap())
                .unwrap()
                .is_none()
        );
        assert!(
            XStatusRequest::parse(&Url::parse("https://x.com/example/status/123/video/0").unwrap())
                .is_err()
        );
        assert!(
            XStatusRequest::parse(&Url::parse("https://x.com/example/status/123/photo/1").unwrap())
                .is_err()
        );
    }

    #[test]
    fn chooses_the_highest_bitrate_mp4() {
        let video = ResolverVideo {
            id: "media".to_owned(),
            url: None,
            duration: Some(1.0),
            formats: vec![
                ResolverFormat {
                    url: "https://video.twimg.com/low.mp4".to_owned(),
                    bitrate: Some(632_000),
                    container: Some("mp4".to_owned()),
                },
                ResolverFormat {
                    url: "https://video.twimg.com/high.mp4".to_owned(),
                    bitrate: Some(2_176_000),
                    container: Some("mp4".to_owned()),
                },
                ResolverFormat {
                    url: "https://video.twimg.com/master.m3u8".to_owned(),
                    bitrate: None,
                    container: Some("m3u8".to_owned()),
                },
            ],
        };
        assert_eq!(
            best_mp4_url(&video),
            Some("https://video.twimg.com/high.mp4")
        );
    }

    #[test]
    fn resolver_configuration_keeps_only_the_public_base_path() {
        let resolved = resolver_url_from_base(
            "https://1.1.1.1/public/status/?ignored=true#fragment",
            "2062110003566362779",
        )
        .unwrap();
        assert_eq!(
            resolved.as_str(),
            "https://1.1.1.1/public/status/2062110003566362779"
        );
        assert!(resolver_url_from_base("http://1.1.1.1/status/", "123").is_err());
    }
}
