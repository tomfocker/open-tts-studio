# 本地模型仓库

此目录是 OpenTTS Studio 唯一推荐的模型包根目录。完整懒人包、运行时、权重、配置和缓存均应保留在各模型自己的子目录中，避免模型文件分散在项目外部磁盘。

```text
models/
├─ IndexTTS2/      # IndexTTS2 完整本地包
├─ VoxCPM2/        # VoxCPM2 完整本地包
└─ GPT-SoVITS/     # GPT-SoVITS 完整本地包
```

语音识别与旁白对齐是独立资产，不能放回任何 TTS 包内：

```text
models/
├─ SenseVoiceSmall/                # 通用本地 ASR
│  ├─ model.pt
│  └─ runtime/python.exe           # 专用 FunASR/CUDA runtime
├─ Qwen3-ASR-1.7B/                 # 可选的精度优先通用 ASR
├─ Qwen3-ForcedAligner-0.6B/       # 最终旁白强制对齐模型
├─ CapsWriter-Offline/             # Qwen ASR / 对齐本地依赖
└─ Qwen3-runtime/python.exe        # Qwen ASR / 对齐专用 runtime
```

- SenseVoiceSmall 和 Qwen3-ASR 仅用于上传音频、实时语音与音色库参考音频的转写；可在桌面设置中切换。
- 最终 TTS 旁白始终使用 Qwen3-ForcedAligner 对真实生成音频和正式文本做强制对齐，不先跑通用 ASR。
- OpenTTS 启动 VoxCPM2 前会自动应用版本化补丁，使 Vox 只预热 TTS；不会因启动 Vox 而加载 SenseVoice。
- 所有这些资产必须是完整本地目录；设置页会分别提示 SenseVoice 模型和 runtime 是否齐全。

这些文件可能很大，且通常带有各自的授权条款，因此整个目录已被 Git 忽略。不要把模型权重、Python 运行时或生成的音频提交到仓库。

桌面端的“模型中心”仍可登记外部候选目录；但当前稳定包应优先放在本目录。切换目录前先停止模型运行时，避免在模型加载或生成中移动文件。
