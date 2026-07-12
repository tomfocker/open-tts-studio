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
  model = "mock-tts"
  input = "你好，这是一段本地 TTS API 测试。"
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
  model = "mock-tts"
  input = "这是一段任务队列测试。"
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
    path = "D:\AI\GPT-SoVITS-v2pro"
    package_label = "v2pro stable"
    user_note = "用于正式项目的本地稳定包"
  } | ConvertTo-Json)

Invoke-RestMethod "http://127.0.0.1:8765/v1/model-packages"
Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:8765/v1/model-packages/$($package.id)/inspect"
Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:8765/v1/model-packages/$($package.id)/activate"
```

Archives such as `.zip` and `.7z` can be recorded for traceability but must be extracted and re-registered as a directory before activation.
