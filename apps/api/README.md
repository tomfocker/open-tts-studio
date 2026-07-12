# Open TTS Desktop API

Local FastAPI service for model registry, speech generation, jobs, voices, and OpenAI-compatible speech requests.

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
