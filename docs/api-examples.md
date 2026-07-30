# API Examples

Base URL:

```text
http://127.0.0.1:8765
```

## Health

```powershell
Invoke-RestMethod http://127.0.0.1:8765/v1/health
```

## List Models

```powershell
Invoke-RestMethod http://127.0.0.1:8765/v1/tts/models
```

## Discover Stable Adapter Capabilities

Use this endpoint before constructing requests from another application. It reports the parameters currently exposed by each stable adapter, required reference audio, output format, and the configured local model instance.

```powershell
Invoke-RestMethod http://127.0.0.1:8765/v1/tts/capabilities
```

## Optional API Key

The local API is open on loopback by default. To require a key, set it before starting the backend:

```powershell
$env:OPEN_TTS_API_KEY = "replace-with-a-long-local-secret"
```

When enabled, `/v1/health`, `/docs`, and `/openapi.json` stay available. All other `/v1/*` calls must include either `X-OpenTTS-Key` or a Bearer token:

```powershell
$headers = @{ "X-OpenTTS-Key" = "replace-with-a-long-local-secret" }
Invoke-RestMethod http://127.0.0.1:8765/v1/tts/capabilities -Headers $headers
```

## OpenAI-Compatible Speech

```powershell
$body = @{
  model = "indextts2"
  input = "你好，这是一段本地 TTS API 测试。"
  reference_audio = "D:\code\tts\models\IndexTTS2\Index-TTS\examples\voice_01.wav"
  control_prompt = "语速自然，情绪稳定，声音清晰。"
  response_format = "wav"
} | ConvertTo-Json

Invoke-RestMethod `
  -Method Post `
  -Uri http://127.0.0.1:8765/v1/audio/speech `
  -ContentType "application/json" `
  -Body $body
```

## TTS-Specific Speech

```powershell
$body = @{
  model = "voxcpm2"
  input = "这是一段 VoxCPM2 测试。"
  voice_prompt = "年轻女声，温柔，自然，语速稍慢"
  response_format = "wav"
} | ConvertTo-Json

Invoke-RestMethod `
  -Method Post `
  -Uri http://127.0.0.1:8765/v1/tts/speech `
  -ContentType "application/json" `
  -Body $body
```

## Create Job

```powershell
$body = @{
  model = "indextts2"
  input = "这是一段任务队列测试。"
  reference_audio = "D:\code\tts\models\IndexTTS2\Index-TTS\examples\voice_01.wav"
  control_prompt = "语速自然，情绪稳定，声音清晰。"
} | ConvertTo-Json

Invoke-RestMethod `
  -Method Post `
  -Uri http://127.0.0.1:8765/v1/tts/jobs `
  -ContentType "application/json" `
  -Body $body
```

`POST /v1/tts/jobs` returns immediately with a `queued` task. Jobs run one at a time so local adapters do not compete for GPU memory. Poll a single job or the task-center summary while it is running:

```powershell
$job = Invoke-RestMethod `
  -Method Post `
  -Uri http://127.0.0.1:8765/v1/tts/jobs `
  -ContentType "application/json" `
  -Body $body

Invoke-RestMethod "http://127.0.0.1:8765/v1/tts/jobs/$($job.id)"
Invoke-RestMethod "http://127.0.0.1:8765/v1/tasks"
```

Each job reports its actual known `stage`, `progress_percent`, recent `events`, and a local `log_file`. The final model-internal inference step cannot always be split into smaller percentages, so its progress can remain at the latest confirmed stage until the adapter returns.

Only a task that is still `queued` can be cancelled safely. A `running` job is intentionally allowed to finish, because abruptly killing an external model process could corrupt its runtime or leave GPU memory in an unknown state. Failed and cancelled jobs can be retried; retrying creates a new job that points back to the original through `retry_of`.

```powershell
Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:8765/v1/tts/jobs/$($job.id)/cancel"
Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:8765/v1/tts/jobs/$($job.id)/retry"
```

The desktop task center also includes non-draft batch projects. Recent speech jobs are stored in `data/config/tasks.json` and their event logs in `data/logs/tasks/` by default. Queued jobs resume when the local backend starts again; a task that was already running during a restart is marked interrupted and made retryable. Set `OPEN_TTS_TASKS_FILE` or `OPEN_TTS_TASK_LOG_DIR` before starting the API to relocate them. Synchronous `/v1/audio/speech` and `/v1/tts/speech` requests are also recorded for diagnostics.

## List Generated Audio Assets

`GET /v1/audio-assets` scans the configured output directory for WAV files and enriches them with matching single-speech or batch-project metadata when available. It is read-only: the API does not move or delete any user files.

```powershell
Invoke-RestMethod "http://127.0.0.1:8765/v1/audio-assets?limit=120"
```

Each item includes `file_path`, `audio_url`, size, modification time, source, and—when known—the model, input text, duration, task, or batch project that created it.

## Batch Project

Projects persist text segments and run them one at a time, which prevents several local models from competing for the same GPU memory. The desktop app provides the recommended TXT/SRT workflow; these endpoints are available to other local applications as well.

```powershell
$body = @{
  title = "旁白第一版"
  model = "indextts2"
  segments = @(
    @{ text = "第一段文本。" },
    @{ text = "第二段文本。" }
  )
} | ConvertTo-Json -Depth 4

$project = Invoke-RestMethod -Method Post -Uri http://127.0.0.1:8765/v1/projects -ContentType "application/json" -Body $body
Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:8765/v1/projects/$($project.id)/run"
Invoke-RestMethod "http://127.0.0.1:8765/v1/projects/$($project.id)/export"
```

## Safely Stop or Resume a Batch Project

Stopping a queued project removes it immediately. Stopping a running project changes it to `cancelling`: the current segment is allowed to finish, but no new segment is started. The project then becomes `cancelled`; completed audio remains available and `resume` continues with the remaining segments.

```powershell
Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:8765/v1/projects/$($project.id)/cancel"
Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:8765/v1/projects/$($project.id)/resume"
```

This API deliberately does not terminate a model process while it is synthesizing. If the backend restarts during a running batch project, that project is marked `cancelled` and can be resumed manually; queued batch projects resume automatically.

## Settings Backup and Migration

`GET /v1/settings/export` returns a versioned JSON document containing only portable configuration: model locations and stable profile labels, enabled states, idle-release settings, and local API/output settings. It never contains the environment API key, voice audio, generated audio, or projects.

```powershell
$backup = Invoke-RestMethod "http://127.0.0.1:8765/v1/settings/export"
$backup | ConvertTo-Json -Depth 6 | Set-Content -Encoding utf8 .\OpenTTS-Studio-settings.json

$restore = Get-Content -Raw .\OpenTTS-Studio-settings.json
Invoke-RestMethod `
  -Method Post `
  -Uri http://127.0.0.1:8765/v1/settings/import `
  -ContentType "application/json" `
  -Body $restore
```

Imports are validated against the versioned schema and the models known to the installed application. If the backup changes the desktop API address or port, restart OpenTTS Studio after importing.

## Model Package Assets

The model package API tracks local directories and archives without loading a model. Directory inspection is bounded and reads only paths, metadata, and adapter-required marker files; archive registration never extracts the archive. Activating a ready directory updates the active model profile and archives the previous stable package. A loaded runtime must be stopped before switching.

```powershell
$package = Invoke-RestMethod `
  -Method Post `
  -Uri http://127.0.0.1:8765/v1/model-packages `
  -ContentType "application/json" `
  -Body (@{
    model_id = "gptsovits"
    path = "D:\code\tts\models\GPT-SoVITS"
    package_label = "v2pro stable"
    user_note = "用于正式项目的本地稳定包"
  } | ConvertTo-Json)

Invoke-RestMethod "http://127.0.0.1:8765/v1/model-packages"
Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:8765/v1/model-packages/$($package.id)/inspect"
Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:8765/v1/model-packages/$($package.id)/activate"
```

Archives such as `.zip` and `.7z` can be recorded for traceability but must be extracted and re-registered as a directory before activation.

# 本地旁白 ASR / 强制对齐

TTS 正式文本与最终音频落盘后，Qwen3-ForcedAligner 直接以正式文本对最终波形强制对齐。未提供 `alignment` 时，`/v1/audio/speech` 的请求和响应与旧版完全相同。不会为此额外调用 ASR。

纯文本转写也可独立调用；设置中可选 SenseVoiceSmall（默认、轻量）或 Qwen3-ASR（精度优先）。上传内容只在本机的选定 ASR 运行时中临时解码，不会送往外部服务：

```powershell
Invoke-RestMethod -Method POST "http://127.0.0.1:8765/v1/audio/transcriptions" `
  -Form @{ file = Get-Item "D:\video\narration.wav"; language = "zh" }
```

该接口返回 `{ "text", "language", "model" }`，用于拿到上传音频的纯文本；当前不会自动切句、生成 SRT 或持久化上传文件。后续独立的“音视频识别 / TXT / SRT”页面会在这个 ASR 基础上实现，不改变此 API 的语义。

```powershell
$speech = Invoke-RestMethod -Method POST http://127.0.0.1:8765/v1/audio/speech -ContentType "application/json" -Body (@{
  model = "indextts2"
  input = "第一句旁白。第二句旁白。"
  response_format = "wav"
  alignment = @{
    enabled = $true
    granularity = "token"
    language = "zh"
    wait_for_result = $false
  }
} | ConvertTo-Json -Depth 5)

$speech.alignment_status # pending
$speech.alignment_url    # /v1/tts/alignments/{id}
```

默认异步时先播放/使用 `audio_url`，稍后读取 `alignment_url`：

```powershell
Invoke-RestMethod "http://127.0.0.1:8765$($speech.alignment_url)"
```

`alignment_status` 的取值为 `pending`、`completed`、`failed` 或 `cancelled`。仅 `completed` 时 `alignment` 才有值；失败时应读取同一查询结果的 `error`，不要用输入文本或推理端估时补造时间戳。

完成后响应中的 `alignment` 结构如下。`segments` 是短句/短语，`tokens` 保留每个汉字（或 Qwen 模型 token）的原文索引，适合逐字动效。`words` 仅在请求 `granularity: "word"` 时提供；中文视频系统应始终优先使用 `tokens`，不要把词视为唯一的中文边界。

```json
{
  "status": "completed",
  "alignment": {
    "version": 1,
    "language": "zh",
    "audio_sha256": "...",
    "transcript_sha256": "...",
    "model_version": "qwen3-forced-aligner-0.6b",
    "duration_seconds": 10.52,
    "segments": [{
      "id": "seg_001",
      "text": "第一句旁白。",
      "char_start": 0,
      "char_end": 6,
      "start_seconds": 0.0,
      "end_seconds": 1.82,
      "confidence": null
    }],
    "tokens": [{
      "text": "第",
      "char_start": 0,
      "char_end": 1,
      "start_seconds": 0.0,
      "end_seconds": 0.14,
      "confidence": null
    }],
    "warnings": []
  }
}
```

Qwen3-ForcedAligner 不输出经过校准的逐 token 置信度，因此会明确返回 `token_confidence_unavailable`，而不会捏造分数；无法读取最终音频、模型未配置、正式原文未被完整对齐或时间轴越界时，状态为 `failed` 并返回明确原因。若业务需要独立转写校验，可单独调用 `/v1/audio/transcriptions` 并根据返回文本决定是否复核；该调用不改变或伪造强制对齐时间轴。

相同的最终音频、正式文本和对齐模型版本会命中本地缓存；缓存和任务记录只保存音频/文本哈希及结果，不保存角色参考音频路径、参考文本、密钥或声纹资料。

短音频可改用 `wait_for_result: true` 一次性等待。对齐任务也出现在 `/v1/tasks`，并可管理：

```powershell
Invoke-RestMethod -Method POST "http://127.0.0.1:8765/v1/tts/alignments/{id}/cancel?force=true"
Invoke-RestMethod -Method POST "http://127.0.0.1:8765/v1/tts/alignments/{id}/retry"
```
