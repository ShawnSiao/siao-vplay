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
npm run typecheck
npm run lint
npm run lint:size
npm test
npx playwright install chromium
npm run test:e2e
cargo test --locked --manifest-path src-tauri/Cargo.toml
```

针对行为修复先增加回归用例。媒体和网络测试使用隔离夹具，不操作个人媒体库。真实媒体、字幕、数据库、凭据、个人日志不得提交。

### 字幕历史查询基准

以下基准默认不运行，使用隔离的合成数据库，对比 1,000 / 10,000 个历史版本下当前轨、元数据和全量版本的读取及 JSON 序列化。运行时可通过 `TEMP` / `TMP` 指定空间充足的临时目录；数据随测试结束清理。

```powershell
cargo test --locked --release --lib --manifest-path src-tauri/Cargo.toml benchmark_subtitle_history_reads -- --ignored --nocapture
```

结果为本机预热缓存下的单次测量。字节数用于验证读取范围，耗时用于比较同一机器的改动前后结果；不能替代应用首屏、内存、真实媒体或安装包验收。

## 安装包

```powershell
npm run desktop:build
```

默认使用仓库的 `src-tauri/target` 与 `artifacts/<version>`。可通过 `CARGO_TARGET_DIR`、`SIAOVPLAY_ARTIFACT_DIR`，或脚本的 `-BuildRoot`、`-OutputDirectory` 参数指定其他磁盘。维护者本机继续采用自己的非系统盘存储规范，外部构建无需 W 盘。

生成文件属于本地候选，不会自动发布。产物清单包含源码 commit、工作区状态、组件清单摘要、签名状态与文件哈希。正式稳定渠道要求可信签名。

稳定版可通过构建脚本的 -TauriConfig 传入仅含 bundle.windows 签名字段的本地 JSON，不允许借此覆盖安装包身份、资源或构建命令。凭据不得提交。安装生命周期测试应使用可丢弃的 Windows 环境；脚本发现已有 SiaoVPlay 安装登记时会拒绝覆盖。

## 提交与协作

- 一个 PR 解决一个连贯问题，说明影响、验证和未覆盖的情况。
- 提交前检查差异，避免格式化无关文件。
- Bug 使用问题模板；安全问题使用 SECURITY.md 中的私密报告方式。
- 不上传私人设计、计划、验收原始资料或受版权限制的媒体。
- 版本以 release.json 为来源；修改后运行 `npm run release:sync` 并检查生成差异。渠道为 development、beta 或 stable；更改渠道不代表验收已经完成。
