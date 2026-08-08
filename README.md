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

## 运行时与最终安装包

默认安装包不把 FFmpeg 和 Whisper 大模型放进安装文件。应用设置中可以选择一个非系统盘目录，按需下载固定版本的 FFmpeg、`ggml-small.bin` 或 `ggml-base.bin`；下载完成后会先校验文件大小和 SHA-256，再切换为可用文件。

最终 Windows 安装包随包提供 Whisper CPU、Whisper Vulkan、`yt-dlp` 和第三方许可证。Whisper 运行时及 `yt-dlp` 的版本和完整性校验继续由应用执行；FFmpeg 与模型保持独立，便于节省初始安装体积并允许切换模型。

构建最终 NSIS 安装包需要准备本机 W 盘资源目录，不把这些二进制文件提交到仓库：

```powershell
$env:CARGO_TARGET_DIR = 'W:\SiaoVPlay\build\runtime-bundle\cargo-target'
npm run desktop:build
```

脚本默认读取 `W:\SiaoVPlay`，只打包 `runtimes\whisper`、`runtimes\whisper-vulkan`、`runtimes\yt-dlp` 和 `licenses`。如需指定资源或构建目录，可直接调用 `tools\build-runtime-bundle.ps1` 的 `-AssetRoot` 与 `-BuildRoot` 参数；脚本会拒绝 C 盘构建目录。

组件来源与固定基线：

- Whisper 模型：[whisper.cpp 模型说明](https://github.com/ggml-org/whisper.cpp/blob/master/models/README.md)；`small` 与 `base` 的大小和 SHA-256 固定在本地运行时目录实现中。
- FFmpeg：[FFmpeg 下载页](https://www.ffmpeg.org/download.html) 与 [gyan.dev Windows 构建](https://www.gyan.dev/ffmpeg/builds/)；按需版本固定为 8.1.2 Essentials。
- `yt-dlp`：[官方 Releases](https://github.com/yt-dlp/yt-dlp/releases)；随包版本固定为 `2026.06.09`。

## 候选版本状态

当前代码已形成 `0.2.0` Windows 10 x64 内部候选版本，并完成本地文件、公开 URL、英泰日韩真实语音、两种 Agent 交接、理解、学习、字幕导出和视频烧录的真实媒体验收。

候选安装包暂未作为公开 Release 提供，原因如下：

- 安装包尚未进行代码签名。
- Windows 11 安装与启动验收尚未完成。
- FFmpeg 和 Whisper 模型属于按需下载依赖；Whisper CPU/Vulkan、`yt-dlp` 和许可证通过 W 盘候选资源目录注入最终安装包，不提交到仓库。

仓库中的开发版本和本地候选包可以从应用相邻目录自动发现随包运行时；设置中选择的目录优先提供按需组件。仍支持通过 `SIAOVPLAY_RUNTIME_DIR`、`SIAOVPLAY_MODEL_DIR`、`SIAOVPLAY_FFMPEG` 或 `SIAOVPLAY_FFPROBE` 做受控的本机调试覆盖。

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
