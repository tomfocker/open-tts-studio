# Open TTS Desktop API

Local FastAPI service for model registry, speech generation, jobs, voices, OpenAI-compatible speech requests, and the maintained Doubao Web/Legado integration.

Run locally:

```powershell
cd apps/api
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -e .
.\.venv\Scripts\python.exe -m uvicorn tts_api.main:app --reload --port 8765
```

Health check:

```powershell
Invoke-RestMethod http://127.0.0.1:8765/v1/health
```

## 本地旁白 ASR / 强制对齐

`POST /v1/audio/speech` 和 `POST /v1/tts/jobs` 可在最终 WAV/MP3 写入后，额外运行本地强制对齐。它不会按输入字数估算时长：每个汉字/token 的时间都来自最终波形的强制对齐帧。最终旁白直接将“最终音频 + 正式 TTS 文本”交给 Qwen3-ForcedAligner；不会先跑 ASR，也绝不根据文本估算时间戳。

Qwen 运行时、CapsWriter 引擎与两个模型均随本机 OpenTTS 资产放在 `models/` 下，默认无需再依赖 PR 项目目录；运行中绝不上传音频、正式文本、参考音频或声纹数据：

```powershell
# 默认资产目录
# models/Qwen3-runtime/python.exe
# models/CapsWriter-Offline
# models/Qwen3-ASR-1.7B
# models/Qwen3-ForcedAligner-0.6B

# 仅在使用自定义资产目录时覆盖默认值
$env:OPEN_TTS_QWEN_ASR_MODEL_DIR = "D:\models\Qwen3-ASR-1.7B"
$env:OPEN_TTS_ALIGNMENT_ALIGNER_MODEL_DIR = "D:\models\Qwen3-ForcedAligner-0.6B"
$env:OPEN_TTS_SENSEVOICE_PYTHON = "D:\code\tts\models\SenseVoiceSmall\runtime\python.exe"
$env:OPEN_TTS_SENSEVOICE_MODEL_DIR = "D:\code\tts\models\SenseVoiceSmall"
$env:OPEN_TTS_SENSEVOICE_DEVICE = "cuda"
```

最终对齐模型为 `Qwen3-ForcedAligner-0.6B`。通用 ASR（`POST /v1/audio/transcriptions` 与音色库参考音视频识别）可在设置中切换：`SenseVoiceSmall`（默认、独立 loopback 服务）或 `Qwen3-ASR-1.7B`（一次性本地子进程）。二者均不参与最终旁白对齐。API 会串行化本地模型切换，避免生成、ASR 与对齐同时占显存。当前 CapsWriter Qwen 路径默认使用稳定的 CPU 提供程序；只有在验证过本机 DML 后，才通过 `OPEN_TTS_QWEN_ASR_DEVICE=dml` 或 `OPEN_TTS_ALIGNMENT_DEVICE=dml` 显式启用 GPU。

### 本机基准（RTX 4070 SUPER 12 GB）

2026-07-31 以 `models/SenseVoiceSmall/example/zh.mp3`（5.616 秒中文音频）实测。下面是当前产品形态的端到端耗时，而不是只计算模型 decode；因此 SenseVoice 是已加载服务的一次请求，Qwen 是当前“一次识别一个本地子进程”的完整调用（包含模型加载）。

| 后端 | 设备 | 耗时 | 转写结果 | 显存观测 |
| --- | --- | ---: | --- | --- |
| SenseVoiceSmall | CUDA | 0.912 秒 | 简体中文，正确 | 已加载服务整卡增量约 0.8 GiB |
| Qwen3-ASR 1.7B | CPU | 5.757 秒 | 正确，输出为繁体 | 不使用 GPU |
| Qwen3-ASR 1.7B | DML + Vulkan | 4.537 秒 | 正确，输出为繁体 | `nvidia-smi` 整卡峰值增量 2,615 MiB |

Qwen DML 路径中，ONNX encoder 使用 DirectML，GGUF LLM 由本地 CapsWriter 自动落在 RTX 4070 SUPER 的 Vulkan 后端；日志显示模型、KV 与计算缓冲分别约为 1,194、224、305 MiB。Windows 的 WDDM/DirectML 不能提供严格的按进程显存归因，所以 2,615 MiB 是采样到的整卡峰值增量，不应视为精确的模型常驻值。

结论：轻量参考音频识别、实时输入和普通转写默认选 SenseVoiceSmall；Qwen3-ASR 保留为设置中的精度/输出风格备选，而不拿它做旁白强制对齐。最终旁白固定走 Qwen3-ForcedAligner，与通用 ASR 开关无关。

部署时应把 SenseVoice 权重和 Python 运行时置于独立目录并设置上述两个 `OPEN_TTS_SENSEVOICE_*` 配置。现有安装会兼容发现 VoxCPM2 包中的旧资产，但不会启动、调用或依赖 VoxCPM2 服务；迁移后可单独替换任意 TTS 包。

对齐请求例子、状态查询、取消与重试见仓库 [`../../docs/api-examples.md`](../../docs/api-examples.md)。持久化对齐任务仅保存哈希、音频输出 URL 和状态；不会保存角色参考音频路径、参考文本、密钥或临时请求文件。

## 本地音视频转写（TXT / SRT）

桌面端“音视频转写”会在 Electron 主进程将用户选择的音频或视频复制到 OpenTTS 自己的受控输入目录；渲染层和 API 仅使用不含路径的 `input_id`。API 调用方可使用上传端点取得同样的输入 ID，不能提交任意本地路径。

- `TXT`：可选 `SenseVoiceSmall`（快速）或 `Qwen3-ASR`（本地高精度）。不启动强制对齐。
- `SRT`：固定使用 `Qwen3-ASR-1.7B + Qwen3-ForcedAligner-0.6B`，按真实媒体波形生成 token 起点和字幕段落；模型或时间戳异常时任务会失败，绝不由文本长度估算时间。
- 上传音频或视频就是最终成片时，SRT 是该文件的真实时间轴；如果之后在剪辑软件中移动、裁切或变速片段，应由剪辑时间线映射字幕偏移。

任务状态、失败原因、取消、强制取消和重试位于 `/v1/transcriptions`。任务记录只保存导入文件名、大小、模型、输出文本和时间轴；不保存原始文件路径、角色参考音频、参考文本、密钥或临时模型请求。

## 本地语音增强对比

桌面端顶部工具栏的“语音增强对比”提供两个独立本地后端：

- `DeepFilterNet3`：速度和保真度更均衡，适合大多数普通噪声、通话底噪和参考音频清理。
- `MossFormer2_SE_48K`：48 kHz 语音增强模型，较积极地改善噪声和混响；建议始终和原音、DeepFilterNet3 结果并排试听后再选用。

二者不会放入桌面主运行时或安装包。请为它们准备单独的 Python 环境，避免为普通 TTS/ASR 用户增加 PyTorch 和模型权重体积。运行任务时不会上传媒体或自动下载模型。

```powershell
# 在一个独立目录创建运行时；请按显卡/CUDA 版本先从 PyTorch 官方安装页选择 torch 安装命令。
py -3.11 -m venv D:\OpenTTS-runtimes\audio-enhancement
D:\OpenTTS-runtimes\audio-enhancement\Scripts\python.exe -m pip install --upgrade pip
D:\OpenTTS-runtimes\audio-enhancement\Scripts\python.exe -m pip install clearvoice
```

Windows 上，DeepFilterNet 的 Python 扩展没有官方预编译包。本软件会优先使用上游发布的 `deep-filter.exe` 和 DeepFilterNet3 ONNX 模型档；把它们放到 DeepFilterNet3 模型目录即可，不需要安装 Rust 或 `deepfilternet`：

```text
models/DeepFilterNet3/
  config.ini
  checkpoints/
  deep-filter.exe
  DeepFilterNet3_onnx.tar.gz
```

Linux/macOS 仍可安装 `deepfilternet`，软件会在没有上述 Windows 二进制档时自动使用 Python 后端。

模型目录必须完整保留，不要只选择单个 `.pt` 文件：

```text
models/DeepFilterNet3/
  config.ini
  checkpoints/

models/MossFormer2-SE-48K/
  last_best_checkpoint
  last_best_checkpoint.pt
```

然后打开“设置 → 生成偏好 → 语音增强（本地）”，分别选择该环境的 `python.exe`、两个模型目录，并按电脑情况选择“自动 / NVIDIA CUDA / CPU”。状态显示“**双模型已就绪**”表示模型目录与运行时文件检查已经通过；首次处理会验证 ClearVoice/Torch 依赖（Windows 的 DeepFilterNet3 由上游二进制执行）。任务会将输入规范化成 48 kHz 单声道 WAV，两个模型串行运行，并保留原始媒体不覆盖。

Doubao status and voice catalog:

```powershell
Invoke-RestMethod http://127.0.0.1:8765/v1/doubao/status
Invoke-RestMethod http://127.0.0.1:8765/v1/doubao/voices
```

The adapter uses a user-supplied Doubao web login Cookie rather than the official Volcano Engine API. Cookie values are redacted from list responses and encrypted at rest with Windows DPAPI. See [`../../docs/doubao-maintenance.md`](../../docs/doubao-maintenance.md) for the API groups, data layout, upstream differences, and maintenance workflow.
