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
