export const browserResourceCapabilities = [
  {
    id: "basic_media",
    title: "基础视频支持",
    resourceIds: ["ffmpeg-cpu"],
    profileIds: [],
    requiresCapabilityIds: [],
  },
  {
    id: "url_import",
    title: "在线视频导入",
    resourceIds: ["ffmpeg-cpu", "yt-dlp"],
    profileIds: [],
    requiresCapabilityIds: [],
  },
  {
    id: "local_transcription",
    title: "本地字幕识别",
    resourceIds: ["ffmpeg-cpu", "whisper-cpu"],
    profileIds: ["fast", "standard"],
    requiresCapabilityIds: [],
  },
];
