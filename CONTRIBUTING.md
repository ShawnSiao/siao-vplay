# 参与贡献

SiaoVPlay 使用 MIT 许可证。提交内容须为原创，或具有允许本项目使用和分发的许可；保留第三方版权与许可声明。

## 开发环境

目标平台为 Windows 10 22H2 x64、Windows 11 x64。安装 Git、Node.js 24.18.0、Rust 1.97.0、Visual Studio C++ Build Tools（含 Windows SDK）与 Microsoft Edge WebView2 Runtime。Rust 版本由 rust-toolchain.toml 固定。

```powershell
git clone https://github.com/ShawnSiao/siao-vplay.git
cd siao-vplay
npm ci
npm run check:release
npm run tauri -- dev
```

浏览器布局预览使用 `npm run dev`；浏览器不具备原生媒体、凭据与文件操作能力。模型和媒体运行时不是编译依赖，由桌面应用按需准备。

## 验证

```powershell
npm run contracts:check
npm run typecheck
npm run lint
npm run lint:size
npm test
npx playwright install chromium
npm run test:e2e
cargo test --locked --manifest-path src-tauri/Cargo.toml
```

针对行为修复先增加回归用例。媒体和网络测试使用隔离夹具，不操作个人媒体库。真实媒体、字幕、数据库、凭据、个人日志不得提交。

### IPC 契约生成

已迁移的 IPC 类型从 Rust 类型及其 Serde 命名生成 JSON Schema，再生成前端类型和静态校验器。修改这些类型后运行 `npm run contracts:generate`，一并提交生成差异。该命令会运行 Rust release 测试；可用 `CARGO_TARGET_DIR` 指定构建缓存位置。

`npm run contracts:check` 只读检查前端生成文件；Rust 测试检查 Schema 与当前源码一致。生成的校验器在构建时编译，应用运行时不需要动态编译 Schema。尚未迁移的接口继续保留现有校验，不能以此命令通过宣称全部 IPC 已覆盖。

### 字幕历史查询基准

以下基准默认不运行，使用隔离的合成数据库，对比 1,000 / 10,000 个历史版本下当前轨、元数据和全量版本的读取及 JSON 序列化。运行时可通过 `TEMP` / `TMP` 指定空间充足的临时目录；数据随测试结束清理。

```powershell
cargo test --locked --release --lib --manifest-path src-tauri/Cargo.toml benchmark_subtitle_history_reads -- --ignored --nocapture
```

结果为本机预热缓存下的单次测量。字节数用于验证读取范围，耗时用于比较同一机器的改动前后结果；不能替代应用首屏、内存、真实媒体或安装包验收。

分页基准使用同样的历史规模，分别测量首尾页（含目录快照与当前轨元数据）、独立当前轨元数据和旧全量元数据。每项连续采样 20 次，输出最小值、中位数、P95（最近秩法）、最大值和序列化字节数。

```powershell
cargo test --locked --release --lib --manifest-path src-tauri/Cargo.toml benchmark_subtitle_metadata_pages -- --ignored --nocapture
```

每个历史版本包含两条合成字幕。测试检查每页最多 24 个历史版本、当前轨数量和返回大小；这些断言不代表长视频多分段或进程内存验收。首轮分页先预热，后续查询共享数据库缓存，计时包含连接、查询和 JSON 序列化，不包含夹具创建。比较结果时应保持机器、构建配置和缓存条件一致；不以固定毫秒阈值判定跨设备性能。

多项目基准另外创建 1,000 / 10,000 个合成项目，每个项目包含三条字幕轨，测量固定目标项目的当前字幕正文和元数据读取。每项同样采样 20 次并检查返回大小稳定；其他项目不包含真实媒体，该测试不覆盖媒体库首屏或解码。

```powershell
cargo test --locked --release --lib --manifest-path src-tauri/Cargo.toml benchmark_current_tracks_across_projects -- --ignored --nocapture
```

### 媒体库查询基准

以下基准使用 1,000 / 10,000 条合成媒体记录和不可播放的占位文件，比较首页摘要、搜索、分页和旧全量项目读取，并测量 10,000 条单合集的首尾页（包含顺序快照计算），以及首集、中间集和末集的相邻剧集查询。测试断言返回条数保持有界；不包含真实视频解码、前端首屏、内存或大型合集界面验收。

```powershell
cargo test --locked --release --lib --manifest-path src-tauri/Cargo.toml benchmark_library_summary_reads -- --ignored --nocapture
```

临时数据库和文件随测试结束清理；每个查询重复测量 20 次，输出 JSON 格式的字节数、最小值、中位数、P95（最近秩法）和最大值，并检查返回字节数稳定。耗时包含查询和 JSON 序列化，不包含数据创建。首页和搜索先预热，分页与全量读取共享此前已访问的数据库缓存。这是单机连续采样，不代表冷启动或跨设备延迟分布，也不设置依赖机器性能的通过阈值。

### 合集列表渲染检查

浏览器用例预载 1,000 / 10,000 条合成剧集，检查每页最多渲染 24 行、键盘翻页及焦点。默认每种规模测量一次；以下命令在预热后分别连续测量 20 次：

```powershell
$env:SIAOVPLAY_LIBRARY_RENDER_BENCHMARK = "1"
npx playwright test e2e/library-window.spec.ts --workers=1
```

输出耗时从页面导航开始，到自动检查确认列表并等待两次动画帧结束，包含浏览器和测试调度开销，不等同于首帧指标。数据已在前端夹具中，不覆盖数据库读取、真实媒体、应用内存峰值或原生 Windows 性能。

## 安装包

构建 NSIS 安装包不需要预先下载媒体运行时或转写模型。在仓库根目录执行：

```powershell
npm run desktop:build
```

默认使用仓库中已忽略的 `src-tauri/target` 与 `artifacts/<version>`。可通过 `CARGO_TARGET_DIR`、`SIAOVPLAY_ARTIFACT_DIR`，或脚本的 `-BuildRoot`、`-OutputDirectory` 参数指定其他目录，无需特定盘符。显式参数优先于环境变量。

例如，将构建缓存和候选包放在仓库内已忽略的 `.tmp` 目录；也可将路径替换为空间充足的位置：

```powershell
$buildRoot = Join-Path (Get-Location).Path '.tmp\build-cache'
$packageDirectory = Join-Path (Get-Location).Path '.tmp\packages'
powershell -NoProfile -ExecutionPolicy Bypass -File tools/build-app-only.ps1 -BuildRoot $buildRoot -OutputDirectory $packageDirectory
```

构建前检查版本与资源清单；媒体运行时和模型的来源、固定版本与哈希见 `src-tauri/resources/local-resource-catalog.json`。隔离安装和文件清单检查使用 `tools/verify-app-only-install.ps1`，构建命令不会自动安装应用。

生成文件属于本地候选，不会自动发布。产物清单包含源码 commit、工作区状态、组件清单摘要、签名状态与文件哈希。正式稳定渠道要求可信签名。

稳定版可通过构建脚本的 -TauriConfig 传入仅含 bundle.windows 签名字段的本地 JSON，不允许借此覆盖安装包身份、资源或构建命令。凭据不得提交。安装生命周期测试应使用可丢弃的 Windows 环境；脚本发现已有 SiaoVPlay 安装登记时会拒绝覆盖。

## 提交与协作

- 修改 README 时同步更新 `README.md` 和 `README.zh-CN.md`，正文保持一致，导航链接分别指向另一入口。文档修改检查内容、链接和 `git diff --check`，无需重新构建安装包。
- 一个 PR 解决一个连贯问题，说明影响、验证和未覆盖的情况。
- 提交前检查差异，避免格式化无关文件。
- Bug 使用问题模板；安全问题使用 SECURITY.md 中的私密报告方式。
- 不上传私人设计、计划、验收原始资料或受版权限制的媒体。
- 版本以 release.json 为来源；修改后运行 `npm run release:sync` 并检查生成差异。渠道为 development、beta 或 stable；更改渠道不代表验收已经完成。

## 本地调试资源

开发版本支持通过 `SIAOVPLAY_RUNTIME_DIR`、`SIAOVPLAY_MODEL_DIR`、`SIAOVPLAY_FFMPEG` 和 `SIAOVPLAY_FFPROBE` 指定受控资源。这些设置用于开发调试，不属于普通安装流程。也可向应用可执行文件传入获准使用的本地媒体路径。
