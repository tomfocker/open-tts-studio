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
