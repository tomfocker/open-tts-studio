# B 站音频取样到克隆工作流设计

## 背景

OpenTTS Studio 当前已经具备本地模型管理、参考音频导入、音色库保存和文本转语音生成能力。用户现在希望接入 `onetool` 项目里的 B 站视频下载能力，让同一个软件内可以完成“视频音频提取、切分、加入音色库、随后克隆”的完整链路。

`D:\code\onetool` 已有 `BilibiliDownloaderService`、IPC、React 工具页和测试。该能力支持 B 站扫码登录、视频/番剧链接解析、分 P/剧集选择、音频流下载、视频流下载、MP4 合并和任务取消。`D:\code\tts` 当前的桌面壳层较轻，只提供后端启动、打开路径、选择参考音频和选择目录；后端是 FastAPI，音色库保存的是 `reference_audio` 路径、`reference_text` 和授权状态。

## 目标

- 在 OpenTTS Studio 内新增 B 站音频取样入口。
- 复用 `onetool` 已验证的 B 站登录、解析、音频流下载核心能力。
- 支持用户选择视频条目后下载音频，并把音频转换为适合克隆模型使用的本地 WAV。
- 支持按开始/结束时间切分参考片段。
- 支持一键把处理后的片段加入当前音色库，并立即选中用于克隆。
- 保持下载、处理、入库三个阶段的状态清晰可见，失败时给出可操作的错误提示。

## 非目标

- 首版不做站内搜索、整季批量下载、投稿合集批量下载。
- 首版不搬运 `onetool` 完整 B 站下载页面，也不支持视频流下载和 MP4 合并入口。
- 首版不自动识别说话人、不自动去伴奏、不自动语音转文字。
- 首版不绕过 B 站权限限制，只处理当前登录账号可正常播放且非 DRM 的内容。
- 首版不把 `D:\code\onetool` 作为运行时外部依赖；复制必要核心代码到 `tts` 项目，避免用户需要同时启动两个软件。

## 方案比较

### 方案 A：轻量移植 onetool 下载核心

把 `onetool` 的 B 站解析、登录和音频流下载服务移植到 `tts` 的 Electron 主进程；前端在 OpenTTS Studio 中增加一个紧凑的“B 站取样”面板；音频下载后交给桌面主进程中的 FFmpeg 转 WAV/切分，再调用现有 FastAPI 音色库接口入库。

优点：
- 复用 `onetool` 已有能力和测试思路。
- 与 B 站扫码登录、Cookie 持久化这类桌面能力天然匹配。
- 不污染 TTS 后端的模型 API 边界。
- 能较快形成“下载到克隆”的单软件闭环。

缺点：
- `tts` 当前桌面主进程是 CommonJS，`onetool` 源码是 TypeScript/Electron-Vite，需要做一次适配。
- `tts` 需要补充 FFmpeg 运行时定位和打包准备。

### 方案 B：FastAPI 端重写下载能力

在 Python API 中实现 B 站解析、登录、下载和 FFmpeg 切分。

优点：
- 所有业务 API 集中在后端。
- 前端只需要 HTTP 调用。

缺点：
- 需要重新实现 `onetool` 已有能力。
- 扫码登录、会话持久化、下载取消和桌面文件路径处理会更绕。
- Python 后端会混入大量与 TTS 模型无关的站点下载逻辑。

### 方案 C：启动或连接 onetool 作为外部能力

让 OpenTTS Studio 调用已经安装或本地运行的 onetool，把下载结果再导入。

优点：
- 代码复制最少。

缺点：
- 用户仍然会感知为两个应用/两个状态。
- 跨应用通信、路径同步和失败处理复杂。
- 不符合“一个软件内完成”的目标。

## 推荐方案

采用方案 A：轻量移植 `onetool` 的 B 站下载核心，并在 OpenTTS Studio 内做一条专用于语音克隆取样的音频流水线。

核心思想是：B 站能力放在 Electron 主进程，TTS 生成和音色库仍由 FastAPI 管理，前端只协调工作流和状态展示。这样既复用 onetool 的成熟部分，也不改变 TTS 后端的主要职责。

## 架构

### Electron 主进程

新增 B 站取样服务，负责：
- 读取和保存 B 站登录会话。
- 生成扫码登录二维码。
- 解析 B 站链接。
- 加载选中条目的音频流信息。
- 下载音频流到本地临时文件。
- 用 FFmpeg 转换为 WAV。
- 按用户填写的时间范围切分 WAV。
- 将最终参考音频输出到 `data/inputs/bilibili`。
- 通过 IPC 向前端广播阶段状态。

### FastAPI 后端

保持现有职责：
- 保存音色库记录。
- 返回音色列表。
- 用选中的 `reference_audio` 执行 TTS/克隆。

首版不要求 FastAPI 参与 B 站下载；只需要在现有 `/v1/tts/voices` 接口中继续接收处理后的参考音频路径。

### React 前端

新增“B 站取样”面板或弹窗：
- 粘贴链接。
- 登录状态和扫码入口。
- 视频/分 P/番剧条目选择。
- 下载与处理状态。
- 开始时间、结束时间输入。
- 参考文本输入。
- 音色名称输入。
- 一键加入音色库并选中。

## 用户流程

1. 用户点击音色库旁的“B 站取样”入口。
2. 软件显示登录状态；未登录时用户点击扫码登录。
3. 用户粘贴 B 站视频、分 P 或番剧链接。
4. 软件解析链接并展示标题、封面和可选条目。
5. 用户选择一个条目。
6. 软件加载音频流可用性。
7. 用户填写片段开始/结束时间，或留空使用完整音频。
8. 用户填写参考文本和音色名称。
9. 用户点击“提取并加入音色库”。
10. 软件下载音频流，转 WAV，切分片段，写入输出目录。
11. 软件调用现有 `createVoice` 接口创建音色。
12. 新音色出现在音色库中并被选中，用户可以直接输入目标文本开始克隆。

## 数据流

```mermaid
flowchart LR
  A["用户粘贴 B 站链接"] --> B["Electron: 解析链接"]
  B --> C["Electron: 加载条目音频流"]
  C --> D["Electron: 下载 audio-only 流"]
  D --> E["Electron: FFmpeg 转 WAV"]
  E --> F["Electron: 按时间切分"]
  F --> G["data/inputs/bilibili/*.wav"]
  G --> H["React: 调用 createVoice"]
  H --> I["FastAPI: 写入 voices.json"]
  I --> J["React: 选中新音色并克隆"]
```

## IPC 接口

新增 `desktopBilibiliSampler` 桥，挂到 `window.desktopBilibiliSampler`。

建议接口：
- `getSession()`
- `startLogin()`
- `pollLogin()`
- `logout()`
- `parseLink(link: string)`
- `loadAudioOptions(kind: string, itemId: string)`
- `extractSample(request)`
- `cancelExtract()`
- `onStateChanged(listener)`

`extractSample(request)` 请求字段：
- `exportMode`: 固定为 `audio-only`。
- `outputDirectory`: 默认 `data/inputs/bilibili`。
- `startSeconds`: 可选，必须大于等于 0。
- `endSeconds`: 可选，必须大于 `startSeconds`。
- `sampleName`: 用于文件名和默认音色名。

返回字段：
- `audioPath`: 处理后的 WAV 文件路径。
- `sourceAudioPath`: 下载得到的原始音频文件路径。
- `durationSeconds`: 处理后片段时长。
- `sampleRate`: WAV 采样率。
- `title`: B 站内容标题。
- `itemTitle`: 选中条目标题。

## 文件结构

新增或修改：
- `apps/desktop/electron/bilibili-sampler-runtime.cjs`
  - B 站解析、登录、音频下载、FFmpeg 转换和切分逻辑。
- `apps/desktop/electron/bilibili-sampler-runtime.test.cjs`
  - 主进程服务单元测试。
- `apps/desktop/electron/main.cjs`
  - 注册 B 站取样 IPC。
- `apps/desktop/electron/preload.cjs`
  - 暴露安全的 `desktopBilibiliSampler` 桥。
- `apps/desktop/electron/desktop-runtime.cjs`
  - 增加 FFmpeg 路径解析和输入目录解析。
- `apps/desktop/electron/desktop-runtime.test.cjs`
  - 覆盖 FFmpeg 路径和输入目录解析。
- `apps/desktop/src/types.ts`
  - 增加 B 站取样相关类型。
- `apps/desktop/src/api.ts`
  - 保持现有音色创建接口；必要时增加辅助类型。
- `apps/desktop/src/App.tsx`
  - 增加 B 站取样入口、面板状态和入库流程。
- `apps/desktop/src/styles.css`
  - 增加取样面板样式，沿用当前 8px 圆角和轻拟物工作台风格。
- `apps/desktop/package.json`
  - 增加 FFmpeg 依赖或准备脚本。
- `apps/desktop/package-lock.json`
  - 依赖锁定更新。
- `data/inputs/bilibili/.gitkeep`
  - 预留音频取样输出目录。

## FFmpeg 策略

开发态：
- 优先使用 `OPEN_TTS_FFMPEG_PATH`。
- 其次查找 `apps/desktop/resources/ffmpeg/ffmpeg.exe`。
- 再尝试使用 `ffmpeg-static` 依赖返回的路径。
- 最后回退到系统 `ffmpeg`。

运行态：
- Windows 打包时应把准备好的 `ffmpeg.exe` 放进应用资源目录。
- 如果找不到 FFmpeg，取样面板显示“无法处理音频，请配置 FFmpeg”，并提供打开设置或重试入口。

## 音频处理

下载阶段：
- 只下载音频流。
- 原始音频文件保存为 `.audio.<ext>`，用于排障。

转换阶段：
- 输出 WAV。
- 首版统一输出单声道、24000 Hz WAV，兼容多数克隆模型。
- FFmpeg 参数建议：`-y -i input -ss start -to end -ac 1 -ar 24000 output.wav`。

校验阶段：
- 输出文件必须存在且非空。
- 片段时长必须大于 0。
- 如能读取 WAV 元数据，返回采样率和时长。

## UI 设计

在音色库区域新增一个小按钮，按钮文案为“取样”，图标使用 `Download`。点击后打开一个设置风格的弹窗，不占用主工作台空间。

弹窗布局：
- 顶部：标题“B 站取样”，右侧关闭。
- 第一段：登录状态、扫码登录/轮询/退出按钮。
- 第二段：链接输入、解析按钮、解析结果。
- 第三段：条目选择、音频流状态。
- 第四段：开始时间、结束时间、音色名称、参考文本。
- 底部：取消、提取并加入音色库。

状态提示：
- 等待操作
- 正在解析
- 正在加载音频流
- 正在下载音频
- 正在转码
- 正在切分
- 正在加入音色库
- 已加入音色库
- 失败

## 错误处理

- 未登录：允许解析公开元数据，但下载受限时提示扫码登录。
- 不支持的链接：提示“请粘贴 B 站视频、分 P 或番剧链接”。
- 没有音频流：提示“当前条目没有可用音频流”。
- 下载失败：显示服务返回的错误，并保留重试入口。
- FFmpeg 不可用：提示配置或安装 FFmpeg。
- 时间范围非法：前端禁止提交，主进程再次校验。
- 切分输出为空：提示重新选择时间范围。
- 音色入库失败：保留已处理 WAV 路径，用户可以手动导入。

## 测试计划

主进程测试：
- 解析 B 站视频链接得到默认条目。
- 解析多分 P 视频后可选择分 P。
- 音频流加载成功时只开放取样下载。
- 下载音频时写入临时文件并移动到目标目录。
- FFmpeg 转 WAV 命令包含 `-ss`、`-to`、`-ac 1`、`-ar 24000`。
- 时间范围非法时拒绝执行。
- 取消下载会中止当前任务并进入取消状态。
- FFmpeg 不可用时返回明确错误。

前端测试：
- 点击“取样”打开弹窗。
- 解析成功后显示条目选择。
- 未选择音频流或时间非法时按钮不可用。
- 提取成功后调用 `createVoice`，新增音色并选中。
- 失败后保留错误提示且不污染音色库。

后端测试：
- 现有音色创建和持久化测试继续通过。
- 新增 B 站来源音色时 `authorization_status` 保存为 `source_bilibili_authorized`。

端到端人工验证：
- 启动桌面软件。
- 扫码登录。
- 粘贴一个普通 B 站视频链接。
- 选择一个 5 到 15 秒片段。
- 提取并加入音色库。
- 使用新音色生成一段测试文本。
- 播放生成结果并确认路径可打开。

## 风险与缓解

- B 站接口变化：把解析和下载逻辑集中在单个主进程文件，减少修复面。
- 登录 Cookie 过期：启动时读取会话，过期后清理并提示重新扫码。
- 部分内容权限不足：错误提示说明需要当前账号能正常播放。
- FFmpeg 缺失：启动前检测，面板内提示可配置路径。
- 参考文本不匹配：首版由用户手填，后续再考虑 ASR 辅助。
- 长音频下载慢：状态分阶段展示，并提供取消。

## 成功标准

- 用户无需离开 OpenTTS Studio 即可从 B 站链接创建一个可用于克隆的音色。
- 创建出的音色会出现在现有音色库中并可被当前模型使用。
- 下载、转码、切分、入库任一阶段失败时都有明确提示。
- 自动化测试覆盖主进程下载/处理核心和前端入库流程。
