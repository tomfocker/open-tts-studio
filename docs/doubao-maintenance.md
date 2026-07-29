# 豆包 Web TTS 自维护说明

## 定位

OpenTTS Studio 的 `doubao-web` 适配器复刻了 `tomfocker/doubao-tts` 的本地语音、Cookie、扫码登录、阅读 TTS、正文缓存和音频预制能力。实现固定参考上游提交：

```text
15ea4b5c8dc4e5e42ab3a411931dab06d4769bf8
```

本项目没有复制或继续执行上游混淆后的业务代码。协议、缓存格式、任务状态机、API 和 React 界面均由本项目重新实现，因此可以独立测试、定位和修改。

豆包连接使用网页端内部接口：

```text
wss://ws-samantha.doubao.com/samantha/audio/tts
```

它不是火山引擎官方开放 API。接口地址、请求字段、错误码和风控策略可能变化，个人或内网使用也应遵守豆包服务条款；需要稳定商业 SLA 时应另接官方适配器。

## 模块边界

| 模块 | 位置 | 职责 |
| --- | --- | --- |
| WebSocket 协议 | `apps/api/tts_api/doubao_protocol.py` | 建连、请求帧、音频帧、错误码、设备 ID |
| 标准适配器 | `apps/api/tts_api/adapters/doubao_web.py` | Cookie 选择、重试、AAC 收集、FFmpeg 转码、统一语音结果 |
| 共享请求节流 | `apps/api/tts_api/doubao_throttle.py` | 所有合成入口共用请求时钟、轮换整轮等待与随机抖动 |
| Cookie 池 | `apps/api/tts_api/doubao_cookies.py` | CRUD、DPAPI、验证、禁用、轮换、次数限制、调用统计 |
| 扫码登录 | `apps/api/tts_api/doubao_qr_login.py` | 二维码会话、状态轮询、登录 Cookie 收集 |
| 阅读客户端 | `apps/api/tts_api/legado_client.py` | 书架、目录、正文和封面代理 |
| 正文/音频缓存 | `apps/api/tts_api/doubao_cache.py` | 书籍正文、章节分段、渐进式索引、音频查找 |
| 预制任务 | `apps/api/tts_api/doubao_prefetch.py` | 单章/批量任务、持久化、暂停、恢复、取消、重试 |
| 现代豆包路由 | `apps/api/tts_api/routes/doubao.py` | `/v1/doubao/*`、旧 `/api/*` 别名、旧 TTS 契约 |
| 阅读路由 | `apps/api/tts_api/routes/legado.py` | 阅读配置、代理、正文缓存、预制任务与音频查询 |
| 兼容设置 | `apps/api/tts_api/routes/doubao_legacy.py` | 设备 ID、旧设置、本地文档、控制台兼容面 |
| 桌面工作台 | `apps/desktop/src/DoubaoWorkspace.tsx` | 合成、登录、账号、阅读、任务、缓存和维护界面 |

豆包代码不侵入其他模型适配器。未来接入官方 API 时，可新增适配器并复用语音结果、任务和桌面层，不需要改写阅读缓存格式。

## 桌面使用

主窗口顶部的云朵按钮或模型条中的“豆包 Web TTS”都会打开独立工作台。

1. 在“登录与账号”中扫码登录；扫码被拦截时可以手工粘贴浏览器请求头中的 Cookie。
2. 使用“全部验证”确认账号有效。默认每个 Cookie 成功调用 10 次后轮换，也可以搜索、排序、多选、切换卡片/列表视图、批量验证或删除、停用、指定当前账号并设置单账号总限制。
3. 在“语音合成”选择 29 个内置音色之一，调整语速和音调，输出 MP3 或 WAV；合成历史保留最近 50 条，可恢复播放、逐条删除或连同音频清空。
4. 阅读用户在“阅读预制”填写阅读 App 的 Web 服务地址和端口，连接书架后可缓存正文或选择章节批量预制音频。整本正文缓存会显示实时章节进度，并可在当前章节完成后取消。向手机复制朗读配置前，还要把“本机朗读服务地址”改为电脑的局域网地址，例如 `http://192.168.1.20:8765`。
5. 阅读实时配置提供默认 5 秒、快速 1 秒、安全 10 秒和自定义模板，可先测试 JSON 契约，再复制或一键导入阅读。Electron 只允许打开 `legado://import/httpTTS?src=<HTTP/HTTPS URL>`，拒绝其他协议、凭据、片段、额外参数和重复 `src`。
6. “任务与缓存”提供暂停、恢复、取消、整任务或单章重试、逐章状态/段落索引检查、逐章音频删除、任务删除、任务文件清理、正文查看、书籍缓存删除和全部清理。
7. “维护”可以调整阅读延迟、段落间隔、失败重试、正文缓存并发和设备 ID 策略，并浏览本项目本地文档。

工作台有独立的浅色/深色主题。窄屏时导航可以横向滑动，页面只保留一个纵向滚动容器。

## API

### 标准合成

`POST /v1/audio/speech` 和 `POST /v1/tts/speech`：

```json
{
  "model": "doubao-web",
  "input": "你好，这是豆包网页端语音。",
  "voice": "zh_female_wenroutaozi_uranus_bigtts",
  "speed": 1.0,
  "pitch": 0,
  "response_format": "mp3"
}
```

支持 `voice`、`speed`（`0.25`–`4.0`）、`pitch`（`-12`–`12`）和 `mp3`/`wav`。输出结构与其他 OpenTTS 模型一致。

### 豆包管理

- `GET /v1/doubao/status`
- `GET /v1/doubao/voices`
- `POST /v1/doubao/auth/qr-code`
- `POST /v1/doubao/auth/qr-status`
- `POST /v1/doubao/auth/qr-confirm`
- `GET|POST|PUT|DELETE /v1/doubao/cookies...`
- `POST /v1/doubao/cookies/batch/test`
- `POST /v1/doubao/cookies/rotate`
- `POST /v1/doubao/cookies/rotation-config`

兼容原项目的 `/api/cookies`、`/api/auth/*`、`/api/voices`、`/api/tts`、`/tts/tts` 等路径。Cookie 列表永远不返回完整值；只有按 ID 明确读取且 `reveal=true` 时才在本机 API 响应中返回明文。

### 阅读与缓存

- `GET /api/legado/tts-config`
- `GET /api/legado/tts-config-prefab`
- `GET /api/reader/tts/stream`
- `GET /api/reader/tts/stream-prefetch`
- `POST /api/legado/proxy/bookshelf|chapters|content`
- `POST /api/legado/book-cache/start`
- `GET /api/legado/book-cache/list|status|stats|chapters|chapter`
- `POST /api/legado/prefetch/start|batch-start`
- `GET /api/legado/prefetch/tasks|status/{taskId}`
- `POST /api/legado/prefetch/pause|resume|cancel|retry/{taskId}`

阅读实时模式会在没有文本时返回合法静音 MP3。预制模式只查询本地缓存，缓存未命中也返回静音，避免阅读客户端因 HTTP 错误中断连续朗读。

## 请求节流与参数语义

标准语音接口、阅读实时流和预制任务都通过同一个 `DoubaoWebAdapter` 路径，并按 Cookie 文件绝对路径共享 `DoubaoRequestThrottler`。这保证不同入口不会各自绕过限速：

- `requestIntervalDelay` 是任意相邻豆包请求开始之间的基础间隔，实际等待为配置值的 `0.8`–`1.3` 倍。
- `requestDelay` 不是每一段都等待；它表示所有有效 Cookie 完成一轮后，在下一次请求前额外等待，实际为配置值的 `1.0`–`1.3` 倍。
- Cookie 选择和下一轮等待安排在同一把锁内；WebSocket 合成本身不占用该锁，因此这里只串行化请求准入，不会阻塞已经开始的音频接收。
- 手工合成、阅读实时请求和预制任务的失败都会进入同一 Cookie 计数、验证、轮换和重试策略。

上游自身存在两套默认来源，不能把其中一套描述成唯一默认值：

| 来源 | `requestIntervalDelay` | `requestDelay` | 重试 | 正文缓存并发 |
| --- | ---: | ---: | ---: | ---: |
| 上游 `config/tts.json` | 1 秒 | 15 秒 | 2 | — |
| 上游 `ConfigService` | 未单列 | 10 秒 | 3 | 20 |
| 当前维护版稳定配置 | 3 秒 | 15 秒 | 3 | 20 |

维护版选择更保守的段落间隔，同时保留界面配置能力；阅读链接里的 `delay` 和预制任务里的 `requestDelay` 会传递到实际豆包请求，不再只是展示参数。

## 上游功能覆盖基线

固定提交中的五个页面和控制台能力已归并到一个工作台：

| 上游功能面 | 维护版位置 | 自动化证据 |
| --- | --- | --- |
| TTS、音色筛选、语速/音调、播放器、历史 | “语音合成” | `test_doubao_protocol.py`、`test_doubao_adapter.py`、标准 speech 路由测试 |
| Cookie 扫码、CRUD、详情、验证、轮换、限次、批量管理 | “登录与账号” | `test_doubao_qr_login.py`、`test_doubao_cookies.py`、`test_doubao_routes.py` |
| 阅读配置、书架/目录/正文代理、实时/预制朗读 | “阅读预制” | `test_legado_routes.py` |
| 正文缓存进度、预制任务、暂停/恢复/取消/重试、缓存详情与清理 | “阅读预制”“任务与缓存” | `test_doubao_cache.py`、`test_doubao_prefetch.py`、`test_legado_routes.py` |
| 设置、设备 ID、控制台健康、日志清理、本地文档 | “维护” | `test_doubao_legacy_routes.py` |
| 固定提交的原 API 路由面 | FastAPI 兼容路由 | `test_doubao_compatibility_surface.py` |

远程公告、强制更新下载和 ZIP 覆盖程序属于远程可执行/供应链能力，按安全边界以本地空公告、Electron 更新器和 HTTP `410` 明确替换，不执行上游实现。

## 本地数据与安全

开发模式默认数据：

```text
data/config/doubao-cookies.json   # DPAPI 密文
data/doubao/                      # 正文、任务、音频索引和设备 ID
data/outputs/                     # 手工生成的 MP3/WAV
```

安装版使用 `%APPDATA%/OpenTTS Studio/data`。以上目录均已从 Git 排除。Windows DPAPI 密文通常只能由创建它的同一 Windows 用户解密，因此不要把 Cookie 文件当作跨机器备份格式；迁移时应在新机器重新扫码。

阅读正文和预制音频可能包含用户书架内容，不应上传到问题单、Git 或公开日志。API 默认只监听 `127.0.0.1`；手机访问时需在应用设置中把 API 监听地址改为 `0.0.0.0`、重启应用，并在“本机朗读服务地址”填写电脑实际的局域网 IP（`0.0.0.0` 只能用于监听，不能作为手机访问地址）。开放局域网监听会同时暴露 Cookie 管理和书架代理接口，只应在可信网络中使用；如需跨越不可信网络，应配置 API 访问密钥或反向代理鉴权。

## 缓存格式

书籍和章节目录使用输入标识的 MD5 前 16 位作为兼容 ID。每章按换行清洗和分段：

```text
prefetch/books/<book-id>/chapters/<chapter-id>/
  index.json
  audio/
    seg_001.mp3
    seg_002.mp3
```

`index.json` 在每个段落完成后原子更新，程序异常退出时可以保留已完成段落。重启后仍处于 `processing` 的任务会恢复为 `paused`，由用户决定继续或删除。

## 与上游有意不同的功能

| 上游行为 | 维护版行为 |
| --- | --- |
| 从远程仓库加载公告和文档 | 公告返回本地空列表；文档读取当前项目 `README.md` 和 `docs/*.md` |
| 上传 ZIP 覆盖运行目录更新 | 返回 HTTP `410`；桌面更新交给 Electron 更新器 |
| 混淆 Node.js 服务作为运行核心 | Python/FastAPI 明文重写并带测试 |
| Cookie 以普通 JSON 值落盘 | Windows DPAPI 加密后落盘 |
| 浏览器多页面管理界面 | 合并为 OpenTTS Studio 独立工作台，并保留兼容 API |

这些差异保留了用户可见用途，同时去掉了远程可执行内容和覆盖运行程序的维护风险。

## 协议变更维护流程

当合成突然失败时，按以下顺序定位：

1. 调用 `/v1/doubao/status`，确认至少一个 Cookie 有效。
2. 在桌面工作台执行单账号验证，区分 Cookie 过期、风控和协议错误。
3. 检查 `data/logs/desktop-api.err.log` 或开发终端中的后端错误。
4. 若所有账号同时出现协议错误，使用自己已登录的豆包网页观察最新 WebSocket 地址、查询参数和帧字段；不要把 Cookie 或完整请求头提交到仓库。
5. 只修改 `doubao_protocol.py` 的协议边界并补对应单元测试，避免把上游字段散落到路由或 UI。
6. 先验证原始 AAC 收集，再验证 FFmpeg MP3/WAV 转码，最后验证标准和阅读接口。

常见错误：

- “没有可用的豆包 Cookie”：扫码登录、启用账号或重新验证。
- `403`/拦截：账号或设备指纹被风控，停止高频请求，不要无限重试。
- `429`：降低批量预制频率，提高“预制段落间隔”。
- “FFmpeg 未找到”：安装版应自带 `resources/ffmpeg/ffmpeg.exe`；开发版执行 `npm install` 或设置 `OPEN_TTS_FFMPEG_PATH`。
- 阅读连接失败：确认阅读 App 已开启 Web 服务，并检查 IP、端口和本机防火墙。

## 验证命令

```powershell
cd apps/api
.\.venv\Scripts\python.exe -m pytest -q

cd ..\desktop
npm run build
npm run test:electron
```

不含真实 Cookie 的自动化测试会使用协议替身验证请求帧、AAC 输出、Cookie 轮换、扫码状态、阅读代理、正文缓存和任务生命周期。发布前的真实接口冒烟测试需要维护者自己的有效 Cookie，只合成一句短文本并立即停止，避免制造不必要的高频调用。
