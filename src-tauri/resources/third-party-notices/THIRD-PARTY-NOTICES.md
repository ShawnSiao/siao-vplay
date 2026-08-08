# SiaoVPlay 可选本地资源说明

版本：0.3.0

本安装包不包含 FFmpeg、FFprobe、yt-dlp、whisper.cpp、VAD 或转写模型。以下组件仅在启用对应本地能力并确认保存位置后下载。

| 资源 | 来源 | 许可证 |
| --- | --- | --- |
| FFmpeg Windows 构建 | https://github.com/BtbN/FFmpeg-Builds | LGPL-2.1-or-later |
| yt-dlp Windows 可执行文件 | https://github.com/yt-dlp/yt-dlp | 组合产物 GPL-3.0-or-later；项目源码 Unlicense |
| whisper.cpp | https://github.com/ggml-org/whisper.cpp | MIT |
| Silero VAD | https://github.com/snakers4/silero-vad | MIT |
| OpenAI Whisper 模型 | https://github.com/openai/whisper | MIT |

固定版本、下载地址、大小和 SHA-256 记录在 `local-resource-catalog.json`。资源管理器完成后，应用将在下载和诊断界面提供对应许可材料。
