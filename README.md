# OpenTTS Studio

OpenTTS Studio 是一个 Windows 桌面端本地 TTS 工作台：统一管理可用的开源模型包，提供桌面生成界面和本地 HTTP API，并让音色、模型目录、运行时状态和生成结果可追踪。

## 当前能力

- 当前提供的语音引擎：IndexTTS2、VoxCPM2、GPT-SoVITS，以及独立维护的豆包 Web TTS 适配器。
- 模型包统一放在项目根目录的 [`models`](models/README.md)；运行时、权重与懒人包文件均留在本机，不进入 Git。
- 模型中心：目录选择、健康检查、启用/禁用、稳定包标记、维护备注和检查历史。
- 运行时管理：按需启动、显示运行状态、空闲自动释放显存、手动停止；不会终止外部懒人包自行启动的服务。
- 桌面端音色库：可将本地参考音频或生成结果一键加入音色库。
- 参考音频导入后会立即在后台识别原文；识别完成后自动恢复当前语音模型预热，减少首次生成等待。
- 便携音色包：参考音频与对应文本可导出为 ZIP，在其他生产环境一键导入。
- B 站取样：桌面端扫码登录、视频/番剧解析、分 P/剧集选择、音频下载、FFmpeg 转 WAV/裁剪、取消任务，并直接入库。
- 豆包工作台：29 个原版音色、语速/音调、MP3/WAV、扫码登录、Cookie 加密池、账号轮换/验证/限次，以及 OpenAI 兼容语音接口。
- 阅读集成：连接“阅读”Web 服务、生成实时/预制朗读配置、缓存整本正文、批量预制章节音频，并管理可暂停/恢复/取消/重试的持久任务。
- 主动模型预热：手动切换模型后立即安全释放冲突显存并等待新模型就绪；IndexTTS2 提供温度、Top-P、Top-K、束搜索、重复惩罚和最大音频 Token 参数。
- 本地 API：`/v1/audio/speech` 与 `/v1/tts/speech`；根据当前稳定适配器拒绝未实现参数，防止桌面端与外部调用不一致。
- 实时语音交互：桌面端“实时”工作台通过 `/v1/realtime` WebSocket 串接 Silero VAD、VoxCPM2 ASR、OpenAI 兼容 LLM 和 VoxCPM2 语音回复；支持文字输入、麦克风、逐句播放、上下文清除和开口打断。

## 实时语音交互

在“实时”工作台填入 OpenAI 兼容 LLM 地址和模型名后即可使用；例如本机 Ollama 的地址通常是 `http://127.0.0.1:11434/v1`。API Key 只保留在当前前端会话内存，不写入本地配置。

首次语音交互需在“设置 → 本地模型”确认 VoxCPM2 已启用且健康。实时模块会使用同一 GPU 串行槽位，不会与普通 TTS/批量任务同时抢占显存。Silero VAD 随桌面包一同提供，无需额外下载；LLM 与 VoxCPM2 权重仍由用户在本机准备。

默认的“Whispera 流式（自动回退）”会在不改动用户 VoxCPM2 模型包的前提下，启动 Whispera 原有的 `voxcpm.streaming_service`，直接使用其 `generate_streaming` 输出 PCM 首块。现有 VoxCPM2 HTTP `/tts` 接口保留为兼容回退，用户也可以在实时工作台明确切换到该模式。

流式服务与普通 VoxCPM2 服务共享 OpenTTS 的 GPU 串行槽位：启动流式服务前会释放普通服务，反之亦然。首次启动需要加载 VoxCPM2 权重；同一会话内的后续句子会复用已加载的流式模型。上游 WebSocket 服务、PCM 首块和 `tts.interrupt` 均已在本机 VoxCPM2 运行时实际验证。

当用户开口打断时，OpenTTS 会先发送上游 `tts.interrupt`；为避免正在执行的 CUDA step 与下一轮 ASR 争用显存，受 OpenTTS 管理的流式子进程会被安全停止。下一轮需要流式 TTS 时会重新加载模型。这是当前上游模型推理不可抢占时优先保证稳定性的取舍。

## 豆包 Web TTS 边界

豆包适配器使用豆包网页端内部 WebSocket，而不是火山引擎官方 API。它需要用户自己的豆包登录 Cookie，接口地址和协议可能随上游网页版本变化，不提供官方稳定性或商业 SLA。Cookie 在 Windows 上使用 DPAPI 加密，仅当前 Windows 用户可解密；扫码会话、Cookie、阅读正文缓存和预制音频都保存在本机并被 Git 忽略。

原项目的语音、账号、阅读、缓存、设置和本地文档能力已用 Python/React 重写。远程公告、远程文档和上传 ZIP 覆盖运行程序不会恢复：公告改为本地空结果，文档读取当前项目文件，更新统一使用 Electron 更新流程。架构、接口、数据目录和维护方法见 [`docs/doubao-maintenance.md`](docs/doubao-maintenance.md)。

## B 站取样边界

取样仅应使用已获得授权、拥有权利或可合法使用的内容。入库时需由用户确认授权状态；下载音频、登录会话和生成结果均为本机数据，不会提交到版本库。

## 开发运行

后端：

```powershell
cd apps/api
.\.venv\Scripts\python.exe -m uvicorn tts_api.main:app --host 127.0.0.1 --port 8765
```

桌面端：

```powershell
cd apps/desktop
npm run desktop
```

## Windows 客户端与更新

```powershell
cd apps/desktop
npm run package:win
```

构建输出在 `apps/desktop/release`：`Setup` 是安装版，`Portable` 是免安装版。安装包会携带 Electron、本地 API、独立 Python 运行时和豆包 AAC 转码所需的 FFmpeg；不会包含大体积模型权重。首次启动后，请在“设置 → 本地模型”中登记或下载模型目录。

正式安装版会在启动后从 GitHub Releases 检查更新，也可在“设置 → 应用更新”手动检查、下载并重启安装。发布新版本时，上传 `Setup`、对应 `.blockmap` 和 `latest.yml` 到同一个 GitHub Release；便携版可作为额外下载项。

### 日常本地打包

本地调试或需要快速分发测试包时，继续使用：

```powershell
cd apps/desktop
npm run package:win
```

这会在 `apps/desktop/release` 生成安装版、便携版、`latest.yml`、安装版 `.blockmap` 与 SHA-256 校验清单。本地构建不会自动创建 GitHub Release。

### 正式发布

正式版本由 GitHub Actions 在 Windows 环境中完成，避免依赖某一台开发电脑。发布前先将 `apps/desktop/package.json` 的 `version` 更新为目标版本并推送该提交；随后创建名称完全一致的 `v` 前缀标签：

```powershell
git tag v0.1.3
git push origin v0.1.3
```

工作流会创建 API 虚拟环境、运行 API 与 Electron 测试、打包安装版与便携版，校验更新元数据与产物版本，并创建对应的 GitHub Release，自动上传 `Setup`、`.blockmap`、`latest.yml`、SHA-256 校验清单和便携版。同时会保留 14 天构建诊断包，便于排查发版失败。标签与 `apps/desktop/package.json` 的版本不一致时会直接失败，避免客户端读取到错误更新元数据。带连字符的标签（例如 `v0.1.3-rc.1`）会发布为预发行版。

如需手动校验已下载的文件，可将其 SHA-256 与同版本 Release 中的 `OpenTTS-Studio-<版本>-checksums.txt` 对照：

```powershell
Get-FileHash .\OpenTTS-Studio-Setup-0.1.3-x64.exe -Algorithm SHA256
```

当前尚未配置 Windows 代码签名；它不影响安装或自动更新，但首次安装仍可能出现 SmartScreen 提示。

## 验证

```powershell
cd apps/api
.\.venv\Scripts\python.exe -m pytest -q

cd ..\desktop
npm run build
npm run test:electron
```
