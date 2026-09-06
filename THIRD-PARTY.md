# 第三方代码与资源

SiaoVPlay 原创代码采用 MIT。第三方内容保留各自许可证，根许可证不重新授权第三方商标、图标、模型或可执行文件。

| 内容 | 来源与许可位置 |
| --- | --- |
| AI 服务图标 | LobeHub，MIT；原声明保留在 src/assets/ai-service-logos/LICENSE |
| React、Tauri 及其他 npm/Rust 依赖 | 精确版本见 package-lock.json、src-tauri/Cargo.lock；许可证以对应发布版本声明为准 |
| 可选 FFmpeg、yt-dlp、whisper.cpp、VAD 与模型 | 来源、固定版本、哈希见 src-tauri/resources/local-resource-catalog.json |
| 安装包中的运行时说明 | src-tauri/resources/third-party-notices/THIRD-PARTY-NOTICES.md |

安装包保持 app-only，大型运行时与模型按需从清单中的源下载。FFmpeg 的具体构建可能适用不同许可；yt-dlp 源码与 Windows 组合可执行文件的许可也不同。不能将「没有打入安装包」理解为可以忽略使用或再分发条件。

每个候选版本需核对锁定依赖与实际下载产物的许可、版权、来源及必要源码说明。重新托管或修改第三方产物前，应重新核查其分发要求。自动扫描只能辅助核查，不能证明所有来源均已审定。

随包 DEPENDENCIES.txt 收录锁定的 Windows Rust 依赖（包括构建/测试依赖）和 npm 生产依赖的许可文本。上游 crate 未附许可文件时，tools/third-party-licenses 保留对应提交的原文、来源与哈希。依赖变化后运行 npm run notices:generate，检查来源与差异；CI 运行 notices:check。
