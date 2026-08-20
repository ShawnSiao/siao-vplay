# SiaoVPlay

SiaoVPlay 是一款 Windows 本地优先的跨语言智能播放器。它面向已经找到海外视频、但缺少可靠简体中文字幕的中文用户。

产品围绕三个层级组织：

```text
观影
→ 按需理解
→ 可选学习
```

默认界面专注观影。剧情解释、人物表达理解、查词和学习卡片只在用户主动操作后出现。

## 当前能力

### 导入与播放

- 导入本地视频，或从公开 HTTPS 直链、点播 M3U8 和 YouTube 公开单视频建立本地项目。
- 不读取浏览器 Cookie、账号内容、用户级 yt-dlp 配置或插件。
- 拒绝私网地址、播放列表、直播、受限内容和不确定结果。
- 不兼容的媒体会生成独立播放版本，不修改原片。
- 保存项目、播放位置、媒体关系和自动生成的项目封面，重启后可以恢复。

### 字幕与翻译

- 导入 UTF-8 SRT、WebVTT 和视频内嵌文本字幕。
- 对字幕时间轴和来源变更执行预检，原文字幕保留为不可变版本。
- 使用本地 Whisper 对英语、泰语、日语和韩语原声生成带词级时间戳的原文字幕。
- 将上述四种语言以及其他语言的原文字幕翻译为简体中文。
- 支持本机 Codex 交接和手动提示词交接；Agent 结果通过任务、版本、范围和完整性检查后写入独立中文草稿，不覆盖原文。
- 提供逐句修正、全局替换、整轨偏移、历史恢复和选段重译。

### 理解、学习与交付

- 在当前播放点按需生成无剧透的剧情和人物表达解读，并明确标记为可能解读。
- 在当前字幕语境中查词，保存带场景截图的学习卡片。
- 导出原文、简体中文或双语 SRT／WebVTT。
- 生成烧录简体中文字幕或双语字幕的独立 MP4；任务支持取消、中断恢复和版本确认。

## 运行时与安装包

`0.3.0` 起，Windows 安装包只包含 SiaoVPlay 产品本体、内置资源目录清单和必要说明。FFmpeg、FFprobe、yt-dlp、whisper.cpp、VAD、转写模型和 GPU 运行时都不进入安装包。

构建 NSIS 安装包不需要预先准备第三方运行时或模型。构建缓存仍放在 W 盘：

```powershell
npm run desktop:build
```

脚本默认使用 `W:\SiaoVPlay\build\app-only-0.3.0`，并在构建前检查 Tauri 资源白名单和内置目录清单。安装包生成后还可以通过 `tools\verify-app-only-install.ps1` 执行隔离安装和实际文件清单检查。

组件来源与固定基线：

- Whisper 模型：[whisper.cpp 模型说明](https://github.com/ggml-org/whisper.cpp/blob/master/models/README.md)；`small` 与 `base` 的大小和 SHA-256 固定在本地运行时目录实现中。
- FFmpeg：[BtbN FFmpeg Builds](https://github.com/BtbN/FFmpeg-Builds)；按需版本固定在内置资源目录清单中。
- `yt-dlp`：[官方 Releases](https://github.com/yt-dlp/yt-dlp/releases)；按需版本固定为 `2026.08.19`。

## 候选版本状态

`0.3.0` 正在实施产品内本地资源管理。当前阶段已经建立产品本体安装包边界；完整的下载、暂停、恢复、修复和迁移能力按后续阶段实现。

候选安装包暂未作为公开 Release 提供，原因如下：

- 安装包尚未进行代码签名。
- Windows 11 安装与启动验收尚未完成。
- 本地资源管理、Windows 11 验收和可信签名尚未全部完成。

开发版本仍支持通过 `SIAOVPLAY_RUNTIME_DIR`、`SIAOVPLAY_MODEL_DIR`、`SIAOVPLAY_FFMPEG` 或 `SIAOVPLAY_FFPROBE` 使用受控的本机调试资源。该方式不属于普通用户安装流程。

开发构建也可以传入本地媒体路径：

```powershell
siao-vplay.exe "D:\Media\example.mp4"
```

## 基本边界

- 本地媒体优先，不提供片源或自有云模型服务。
- 不绕过登录、会员、DRM 或平台访问限制。
- 只处理用户拥有权利或明确获准处理的媒体。
- 向外部 Agent 发送材料前显示接收服务和发送范围，不暴露本机媒体路径。
- SiaoVPlay 不是视频剪辑器；复杂时间轴、剪辑和专业字幕审校继续由 SiaoCut 承担。
