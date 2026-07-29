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

Doubao status and voice catalog:

```powershell
Invoke-RestMethod http://127.0.0.1:8765/v1/doubao/status
Invoke-RestMethod http://127.0.0.1:8765/v1/doubao/voices
```

The adapter uses a user-supplied Doubao web login Cookie rather than the official Volcano Engine API. Cookie values are redacted from list responses and encrypted at rest with Windows DPAPI. See [`../../docs/doubao-maintenance.md`](../../docs/doubao-maintenance.md) for the API groups, data layout, upstream differences, and maintenance workflow.
