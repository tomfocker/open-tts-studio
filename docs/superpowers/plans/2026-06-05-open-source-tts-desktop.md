# Open Source TTS Desktop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first working version of a Windows-focused desktop app that manages local open-source TTS models, generates speech, and exposes a localhost API.

**Architecture:** Use an Electron + React desktop shell that talks to a Python FastAPI service. The FastAPI service owns the public API, model registry, job queue, generated audio files, and adapter routing. Model adapters run in isolated Python environments and are invoked through a narrow adapter contract.

**Tech Stack:** Electron, Vite, React, TypeScript, Python 3.11, FastAPI, Pydantic, pytest, httpx, soundfile or wave, FFmpeg, uv or micromamba for per-model runtimes.

---

## File Structure

Create this monorepo layout:

```text
apps/
  api/
    pyproject.toml
    README.md
    tts_api/
      __init__.py
      main.py
      config.py
      schemas.py
      registry.py
      jobs.py
      audio.py
      errors.py
      adapters/
        __init__.py
        base.py
        mock.py
        voxcpm2.py
        f5_tts.py
      routes/
        __init__.py
        health.py
        models.py
        voices.py
        speech.py
        jobs.py
    tests/
      test_health.py
      test_registry.py
      test_speech_api.py
      test_jobs.py
  desktop/
    package.json
    index.html
    electron/
      main.ts
    src/
      main.tsx
      App.tsx
      api.ts
      types.ts
      styles.css
model-registry/
  models.json
docs/
  api-examples.md
```

Responsibilities:

- `apps/api/tts_api/main.py`: FastAPI app assembly and route registration.
- `apps/api/tts_api/config.py`: local paths, port, generated audio directory, model registry path.
- `apps/api/tts_api/schemas.py`: shared request/response schemas.
- `apps/api/tts_api/registry.py`: model metadata loading and capability filtering.
- `apps/api/tts_api/jobs.py`: in-memory job queue for v1.
- `apps/api/tts_api/audio.py`: WAV writing, output path creation, and file URL helpers.
- `apps/api/tts_api/adapters/base.py`: adapter protocol.
- `apps/api/tts_api/adapters/mock.py`: deterministic WAV generator for end-to-end tests.
- `apps/api/tts_api/adapters/voxcpm2.py`: VoxCPM2 command/runtime adapter.
- `apps/api/tts_api/adapters/f5_tts.py`: F5-TTS command/runtime adapter.
- `apps/api/tts_api/routes/*.py`: narrow API route modules.
- `apps/desktop/src/*`: desktop UI, API client, and simple generation workflow.

---

### Task 1: Backend Project Skeleton

**Files:**
- Create: `apps/api/pyproject.toml`
- Create: `apps/api/README.md`
- Create: `apps/api/tts_api/__init__.py`
- Create: `apps/api/tts_api/main.py`
- Create: `apps/api/tts_api/config.py`
- Create: `apps/api/tts_api/routes/__init__.py`
- Create: `apps/api/tts_api/routes/health.py`
- Test: `apps/api/tests/test_health.py`

- [ ] **Step 1: Create the backend package metadata**

Create `apps/api/pyproject.toml`:

```toml
[project]
name = "open-tts-desktop-api"
version = "0.1.0"
description = "Local API gateway for open-source TTS desktop app"
requires-python = ">=3.11,<3.13"
dependencies = [
  "fastapi>=0.115.0",
  "uvicorn[standard]>=0.30.0",
  "pydantic>=2.8.0",
  "httpx>=0.27.0",
  "pytest>=8.2.0",
  "pytest-asyncio>=0.23.0"
]

[tool.pytest.ini_options]
pythonpath = ["."]
testpaths = ["tests"]
asyncio_mode = "auto"
```

- [ ] **Step 2: Create backend README**

Create `apps/api/README.md`:

```markdown
# Open TTS Desktop API

Local FastAPI service for model registry, speech generation, jobs, voices, and OpenAI-compatible speech requests.

Run locally:

```powershell
cd apps/api
uv sync
uv run uvicorn tts_api.main:app --reload --port 8765
```

Health check:

```powershell
Invoke-RestMethod http://127.0.0.1:8765/v1/health
```
```

- [ ] **Step 3: Add configuration**

Create `apps/api/tts_api/config.py`:

```python
from functools import lru_cache
from pathlib import Path
from pydantic import BaseModel


class Settings(BaseModel):
    app_name: str = "Open TTS Desktop API"
    api_host: str = "127.0.0.1"
    api_port: int = 8765
    workspace_root: Path = Path(__file__).resolve().parents[3]
    output_dir: Path = Path(__file__).resolve().parents[3] / "data" / "outputs"
    model_registry_path: Path = Path(__file__).resolve().parents[3] / "model-registry" / "models.json"


@lru_cache
def get_settings() -> Settings:
    settings = Settings()
    settings.output_dir.mkdir(parents=True, exist_ok=True)
    return settings
```

- [ ] **Step 4: Add FastAPI app and health route**

Create `apps/api/tts_api/__init__.py`:

```python
__all__ = ["main"]
```

Create `apps/api/tts_api/routes/__init__.py`:

```python
__all__ = ["health"]
```

Create `apps/api/tts_api/routes/health.py`:

```python
from fastapi import APIRouter
from tts_api.config import get_settings

router = APIRouter()


@router.get("/v1/health")
def health() -> dict[str, object]:
    settings = get_settings()
    return {
        "status": "ok",
        "service": settings.app_name,
        "port": settings.api_port,
    }
```

Create `apps/api/tts_api/main.py`:

```python
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from tts_api.routes import health


def create_app() -> FastAPI:
    app = FastAPI(title="Open TTS Desktop API", version="0.1.0")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(health.router)
    return app


app = create_app()
```

- [ ] **Step 5: Write health test**

Create `apps/api/tests/test_health.py`:

```python
from fastapi.testclient import TestClient
from tts_api.main import app


def test_health_endpoint_returns_ok():
    client = TestClient(app)
    response = client.get("/v1/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"
    assert response.json()["service"] == "Open TTS Desktop API"
```

- [ ] **Step 6: Run backend test**

Run:

```powershell
cd apps/api
uv run pytest tests/test_health.py -v
```

Expected:

```text
tests/test_health.py::test_health_endpoint_returns_ok PASSED
```

- [ ] **Step 7: Commit**

Run:

```powershell
git add apps/api
git commit -m "feat: add local tts api skeleton"
```

---

### Task 2: Model Registry And Capability Metadata

**Files:**
- Create: `model-registry/models.json`
- Create: `apps/api/tts_api/schemas.py`
- Create: `apps/api/tts_api/registry.py`
- Create: `apps/api/tts_api/routes/models.py`
- Modify: `apps/api/tts_api/main.py`
- Test: `apps/api/tests/test_registry.py`

- [ ] **Step 1: Write failing registry tests**

Create `apps/api/tests/test_registry.py`:

```python
from pathlib import Path
from tts_api.registry import ModelRegistry


def test_registry_loads_models_from_json(tmp_path: Path):
    registry_path = tmp_path / "models.json"
    registry_path.write_text(
        """
        [
          {
            "id": "mock-tts",
            "display_name": "Mock TTS",
            "priority": "P0",
            "source_url": "local",
            "code_license": "MIT",
            "weights_license": "MIT",
            "commercial_use": "allowed",
            "recommended_vram_gb": 0,
            "features": ["plain_tts", "streaming"],
            "native_sample_rate": 24000,
            "adapter": "mock"
          }
        ]
        """,
        encoding="utf-8",
    )

    registry = ModelRegistry(registry_path)
    models = registry.list_models()

    assert len(models) == 1
    assert models[0].id == "mock-tts"
    assert models[0].features == ["plain_tts", "streaming"]


def test_registry_returns_model_by_id(tmp_path: Path):
    registry_path = tmp_path / "models.json"
    registry_path.write_text(
        """
        [
          {
            "id": "mock-tts",
            "display_name": "Mock TTS",
            "priority": "P0",
            "source_url": "local",
            "code_license": "MIT",
            "weights_license": "MIT",
            "commercial_use": "allowed",
            "recommended_vram_gb": 0,
            "features": ["plain_tts"],
            "native_sample_rate": 24000,
            "adapter": "mock"
          }
        ]
        """,
        encoding="utf-8",
    )

    registry = ModelRegistry(registry_path)
    model = registry.get_model("mock-tts")

    assert model.id == "mock-tts"
    assert model.adapter == "mock"
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```powershell
cd apps/api
uv run pytest tests/test_registry.py -v
```

Expected:

```text
ModuleNotFoundError: No module named 'tts_api.registry'
```

- [ ] **Step 3: Add schemas**

Create `apps/api/tts_api/schemas.py`:

```python
from enum import StrEnum
from pydantic import BaseModel, Field


class CommercialUse(StrEnum):
    allowed = "allowed"
    restricted = "restricted"
    unknown = "unknown"


class ModelInfo(BaseModel):
    id: str
    display_name: str
    priority: str
    source_url: str
    code_license: str
    weights_license: str
    commercial_use: CommercialUse
    recommended_vram_gb: int = Field(ge=0)
    features: list[str]
    native_sample_rate: int
    adapter: str


class SpeechRequest(BaseModel):
    model: str
    input: str = Field(min_length=1)
    voice: str | None = None
    voice_prompt: str | None = None
    reference_audio: str | None = None
    reference_text: str | None = None
    emotion: str | None = None
    language: str | None = None
    response_format: str = "wav"
    speed: float = Field(default=1.0, ge=0.25, le=4.0)
    stream: bool = False


class SpeechResult(BaseModel):
    audio_url: str
    file_path: str
    model: str
    sample_rate: int
    duration_seconds: float


class JobStatus(StrEnum):
    queued = "queued"
    running = "running"
    succeeded = "succeeded"
    failed = "failed"


class JobInfo(BaseModel):
    id: str
    status: JobStatus
    request: SpeechRequest
    result: SpeechResult | None = None
    error: str | None = None
```

- [ ] **Step 4: Add registry implementation**

Create `apps/api/tts_api/registry.py`:

```python
import json
from pathlib import Path
from tts_api.schemas import ModelInfo


class ModelRegistry:
    def __init__(self, registry_path: Path):
        self.registry_path = registry_path

    def list_models(self) -> list[ModelInfo]:
        raw = json.loads(self.registry_path.read_text(encoding="utf-8"))
        return [ModelInfo.model_validate(item) for item in raw]

    def get_model(self, model_id: str) -> ModelInfo:
        for model in self.list_models():
            if model.id == model_id:
                return model
        raise KeyError(f"Unknown model: {model_id}")
```

- [ ] **Step 5: Add default model metadata**

Create `model-registry/models.json`:

```json
[
  {
    "id": "mock-tts",
    "display_name": "Mock TTS",
    "priority": "P0",
    "source_url": "local",
    "code_license": "MIT",
    "weights_license": "MIT",
    "commercial_use": "allowed",
    "recommended_vram_gb": 0,
    "features": ["plain_tts", "streaming"],
    "native_sample_rate": 24000,
    "adapter": "mock"
  },
  {
    "id": "voxcpm2",
    "display_name": "VoxCPM2",
    "priority": "P0",
    "source_url": "https://github.com/OpenBMB/VoxCPM",
    "code_license": "Apache-2.0",
    "weights_license": "Apache-2.0",
    "commercial_use": "allowed",
    "recommended_vram_gb": 8,
    "features": ["plain_tts", "streaming", "voice_design", "voice_clone", "controllable_clone"],
    "native_sample_rate": 48000,
    "adapter": "voxcpm2"
  },
  {
    "id": "f5-tts",
    "display_name": "F5-TTS",
    "priority": "P0",
    "source_url": "https://github.com/SWivid/F5-TTS",
    "code_license": "MIT",
    "weights_license": "CC-BY-NC",
    "commercial_use": "restricted",
    "recommended_vram_gb": 6,
    "features": ["plain_tts", "voice_clone"],
    "native_sample_rate": 24000,
    "adapter": "f5_tts"
  }
]
```

- [ ] **Step 6: Add model route**

Create `apps/api/tts_api/routes/models.py`:

```python
from fastapi import APIRouter
from tts_api.config import get_settings
from tts_api.registry import ModelRegistry
from tts_api.schemas import ModelInfo

router = APIRouter()


@router.get("/v1/tts/models", response_model=list[ModelInfo])
def list_models() -> list[ModelInfo]:
    settings = get_settings()
    registry = ModelRegistry(settings.model_registry_path)
    return registry.list_models()
```

Modify `apps/api/tts_api/main.py`:

```python
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from tts_api.routes import health, models


def create_app() -> FastAPI:
    app = FastAPI(title="Open TTS Desktop API", version="0.1.0")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(health.router)
    app.include_router(models.router)
    return app


app = create_app()
```

- [ ] **Step 7: Run registry tests**

Run:

```powershell
cd apps/api
uv run pytest tests/test_registry.py -v
```

Expected:

```text
tests/test_registry.py::test_registry_loads_models_from_json PASSED
tests/test_registry.py::test_registry_returns_model_by_id PASSED
```

- [ ] **Step 8: Commit**

Run:

```powershell
git add apps/api model-registry
git commit -m "feat: add tts model registry"
```

---

### Task 3: Adapter Contract And Mock Speech Generation

**Files:**
- Create: `apps/api/tts_api/audio.py`
- Create: `apps/api/tts_api/adapters/__init__.py`
- Create: `apps/api/tts_api/adapters/base.py`
- Create: `apps/api/tts_api/adapters/mock.py`
- Test: `apps/api/tests/test_speech_api.py`

- [ ] **Step 1: Write failing adapter test**

Create `apps/api/tests/test_speech_api.py`:

```python
from pathlib import Path
from tts_api.adapters.mock import MockTtsAdapter
from tts_api.config import Settings
from tts_api.schemas import SpeechRequest


def test_mock_adapter_writes_wav_file(tmp_path: Path):
    settings = Settings(output_dir=tmp_path)
    adapter = MockTtsAdapter(settings=settings)
    request = SpeechRequest(model="mock-tts", input="hello")

    result = adapter.synthesize(request)

    output_path = Path(result.file_path)
    assert output_path.exists()
    assert output_path.suffix == ".wav"
    assert result.model == "mock-tts"
    assert result.sample_rate == 24000
    assert result.duration_seconds > 0
```

- [ ] **Step 2: Run test to verify failure**

Run:

```powershell
cd apps/api
uv run pytest tests/test_speech_api.py -v
```

Expected:

```text
ModuleNotFoundError: No module named 'tts_api.adapters'
```

- [ ] **Step 3: Add WAV output helper**

Create `apps/api/tts_api/audio.py`:

```python
import math
import wave
from pathlib import Path
from uuid import uuid4


def create_output_path(output_dir: Path, suffix: str = ".wav") -> Path:
    output_dir.mkdir(parents=True, exist_ok=True)
    return output_dir / f"{uuid4().hex}{suffix}"


def write_sine_wav(path: Path, sample_rate: int = 24000, duration_seconds: float = 0.6) -> None:
    amplitude = 12000
    frequency = 440
    frame_count = int(sample_rate * duration_seconds)
    with wave.open(str(path), "wb") as wav_file:
        wav_file.setnchannels(1)
        wav_file.setsampwidth(2)
        wav_file.setframerate(sample_rate)
        for frame in range(frame_count):
            value = int(amplitude * math.sin(2 * math.pi * frequency * frame / sample_rate))
            wav_file.writeframesraw(value.to_bytes(2, byteorder="little", signed=True))
```

- [ ] **Step 4: Add adapter base class**

Create `apps/api/tts_api/adapters/__init__.py`:

```python
__all__ = ["base", "mock", "voxcpm2", "f5_tts"]
```

Create `apps/api/tts_api/adapters/base.py`:

```python
from abc import ABC, abstractmethod
from tts_api.schemas import SpeechRequest, SpeechResult


class TtsAdapter(ABC):
    @abstractmethod
    def synthesize(self, request: SpeechRequest) -> SpeechResult:
        raise NotImplementedError

    def health(self) -> dict[str, object]:
        return {"status": "ok"}
```

- [ ] **Step 5: Add mock adapter**

Create `apps/api/tts_api/adapters/mock.py`:

```python
from pathlib import Path
from tts_api.adapters.base import TtsAdapter
from tts_api.audio import create_output_path, write_sine_wav
from tts_api.config import Settings, get_settings
from tts_api.schemas import SpeechRequest, SpeechResult


class MockTtsAdapter(TtsAdapter):
    def __init__(self, settings: Settings | None = None):
        self.settings = settings or get_settings()

    def synthesize(self, request: SpeechRequest) -> SpeechResult:
        output_path = create_output_path(self.settings.output_dir, ".wav")
        write_sine_wav(output_path, sample_rate=24000, duration_seconds=0.6)
        return SpeechResult(
            audio_url=f"/outputs/{Path(output_path).name}",
            file_path=str(output_path),
            model=request.model,
            sample_rate=24000,
            duration_seconds=0.6,
        )
```

- [ ] **Step 6: Run adapter test**

Run:

```powershell
cd apps/api
uv run pytest tests/test_speech_api.py -v
```

Expected:

```text
tests/test_speech_api.py::test_mock_adapter_writes_wav_file PASSED
```

- [ ] **Step 7: Commit**

Run:

```powershell
git add apps/api
git commit -m "feat: add tts adapter contract"
```

---

### Task 4: Speech API Route

**Files:**
- Create: `apps/api/tts_api/errors.py`
- Create: `apps/api/tts_api/routes/speech.py`
- Modify: `apps/api/tts_api/main.py`
- Modify: `apps/api/tests/test_speech_api.py`

- [ ] **Step 1: Add failing API tests**

Append to `apps/api/tests/test_speech_api.py`:

```python
from fastapi.testclient import TestClient
from tts_api.main import app


def test_openai_compatible_speech_endpoint_returns_audio_file():
    client = TestClient(app)
    response = client.post(
        "/v1/audio/speech",
        json={"model": "mock-tts", "input": "hello", "response_format": "wav"},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["model"] == "mock-tts"
    assert body["audio_url"].endswith(".wav")
    assert body["sample_rate"] == 24000


def test_speech_endpoint_rejects_unknown_model():
    client = TestClient(app)
    response = client.post(
        "/v1/audio/speech",
        json={"model": "missing-model", "input": "hello"},
    )

    assert response.status_code == 404
    assert response.json()["detail"] == "Unknown model: missing-model"
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```powershell
cd apps/api
uv run pytest tests/test_speech_api.py -v
```

Expected:

```text
404 Not Found for /v1/audio/speech
```

- [ ] **Step 3: Add adapter resolver**

Create `apps/api/tts_api/errors.py`:

```python
from fastapi import HTTPException


def unknown_model_error(model_id: str) -> HTTPException:
    return HTTPException(status_code=404, detail=f"Unknown model: {model_id}")


def unsupported_adapter_error(adapter: str) -> HTTPException:
    return HTTPException(status_code=501, detail=f"Unsupported adapter: {adapter}")
```

Create `apps/api/tts_api/routes/speech.py`:

```python
from fastapi import APIRouter
from tts_api.adapters.mock import MockTtsAdapter
from tts_api.config import get_settings
from tts_api.errors import unknown_model_error, unsupported_adapter_error
from tts_api.registry import ModelRegistry
from tts_api.schemas import SpeechRequest, SpeechResult

router = APIRouter()


def synthesize_with_registered_adapter(request: SpeechRequest) -> SpeechResult:
    settings = get_settings()
    registry = ModelRegistry(settings.model_registry_path)
    try:
        model = registry.get_model(request.model)
    except KeyError:
        raise unknown_model_error(request.model)

    if model.adapter == "mock":
        return MockTtsAdapter(settings=settings).synthesize(request)

    raise unsupported_adapter_error(model.adapter)


@router.post("/v1/audio/speech", response_model=SpeechResult)
def openai_compatible_speech(request: SpeechRequest) -> SpeechResult:
    return synthesize_with_registered_adapter(request)


@router.post("/v1/tts/speech", response_model=SpeechResult)
def tts_speech(request: SpeechRequest) -> SpeechResult:
    return synthesize_with_registered_adapter(request)
```

- [ ] **Step 4: Register route and static output files**

Modify `apps/api/tts_api/main.py`:

```python
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from tts_api.config import get_settings
from tts_api.routes import health, models, speech


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(title="Open TTS Desktop API", version="0.1.0")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.mount("/outputs", StaticFiles(directory=settings.output_dir), name="outputs")
    app.include_router(health.router)
    app.include_router(models.router)
    app.include_router(speech.router)
    return app


app = create_app()
```

- [ ] **Step 5: Run speech API tests**

Run:

```powershell
cd apps/api
uv run pytest tests/test_speech_api.py -v
```

Expected:

```text
tests/test_speech_api.py::test_mock_adapter_writes_wav_file PASSED
tests/test_speech_api.py::test_openai_compatible_speech_endpoint_returns_audio_file PASSED
tests/test_speech_api.py::test_speech_endpoint_rejects_unknown_model PASSED
```

- [ ] **Step 6: Commit**

Run:

```powershell
git add apps/api
git commit -m "feat: add local speech api"
```

---

### Task 5: Job Queue For Batch And Long Text Foundation

**Files:**
- Create: `apps/api/tts_api/jobs.py`
- Create: `apps/api/tts_api/routes/jobs.py`
- Modify: `apps/api/tts_api/main.py`
- Test: `apps/api/tests/test_jobs.py`

- [ ] **Step 1: Write failing job tests**

Create `apps/api/tests/test_jobs.py`:

```python
from fastapi.testclient import TestClient
from tts_api.main import app


def test_create_job_returns_queued_or_completed_job():
    client = TestClient(app)
    response = client.post(
        "/v1/tts/jobs",
        json={"model": "mock-tts", "input": "hello job"},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["id"]
    assert body["status"] in ["queued", "running", "succeeded"]
    assert body["request"]["model"] == "mock-tts"


def test_get_job_returns_existing_job():
    client = TestClient(app)
    create_response = client.post(
        "/v1/tts/jobs",
        json={"model": "mock-tts", "input": "hello job"},
    )
    job_id = create_response.json()["id"]

    response = client.get(f"/v1/tts/jobs/{job_id}")

    assert response.status_code == 200
    assert response.json()["id"] == job_id
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```powershell
cd apps/api
uv run pytest tests/test_jobs.py -v
```

Expected:

```text
404 Not Found for /v1/tts/jobs
```

- [ ] **Step 3: Add in-memory job store**

Create `apps/api/tts_api/jobs.py`:

```python
from uuid import uuid4
from tts_api.schemas import JobInfo, JobStatus, SpeechRequest, SpeechResult


class JobStore:
    def __init__(self):
        self._jobs: dict[str, JobInfo] = {}

    def create(self, request: SpeechRequest) -> JobInfo:
        job = JobInfo(id=uuid4().hex, status=JobStatus.queued, request=request)
        self._jobs[job.id] = job
        return job

    def mark_running(self, job_id: str) -> JobInfo:
        job = self._jobs[job_id]
        updated = job.model_copy(update={"status": JobStatus.running})
        self._jobs[job_id] = updated
        return updated

    def mark_succeeded(self, job_id: str, result: SpeechResult) -> JobInfo:
        job = self._jobs[job_id]
        updated = job.model_copy(update={"status": JobStatus.succeeded, "result": result})
        self._jobs[job_id] = updated
        return updated

    def mark_failed(self, job_id: str, error: str) -> JobInfo:
        job = self._jobs[job_id]
        updated = job.model_copy(update={"status": JobStatus.failed, "error": error})
        self._jobs[job_id] = updated
        return updated

    def get(self, job_id: str) -> JobInfo | None:
        return self._jobs.get(job_id)


job_store = JobStore()
```

- [ ] **Step 4: Add job routes**

Create `apps/api/tts_api/routes/jobs.py`:

```python
from fastapi import APIRouter, HTTPException
from tts_api.jobs import job_store
from tts_api.routes.speech import synthesize_with_registered_adapter
from tts_api.schemas import JobInfo, SpeechRequest

router = APIRouter()


@router.post("/v1/tts/jobs", response_model=JobInfo)
def create_job(request: SpeechRequest) -> JobInfo:
    job = job_store.create(request)
    job_store.mark_running(job.id)
    try:
        result = synthesize_with_registered_adapter(request)
    except Exception as exc:
        return job_store.mark_failed(job.id, str(exc))
    return job_store.mark_succeeded(job.id, result)


@router.get("/v1/tts/jobs/{job_id}", response_model=JobInfo)
def get_job(job_id: str) -> JobInfo:
    job = job_store.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail=f"Unknown job: {job_id}")
    return job
```

- [ ] **Step 5: Register job routes**

Modify `apps/api/tts_api/main.py`:

```python
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from tts_api.config import get_settings
from tts_api.routes import health, jobs, models, speech


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(title="Open TTS Desktop API", version="0.1.0")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.mount("/outputs", StaticFiles(directory=settings.output_dir), name="outputs")
    app.include_router(health.router)
    app.include_router(models.router)
    app.include_router(speech.router)
    app.include_router(jobs.router)
    return app


app = create_app()
```

- [ ] **Step 6: Run job tests**

Run:

```powershell
cd apps/api
uv run pytest tests/test_jobs.py -v
```

Expected:

```text
tests/test_jobs.py::test_create_job_returns_queued_or_completed_job PASSED
tests/test_jobs.py::test_get_job_returns_existing_job PASSED
```

- [ ] **Step 7: Commit**

Run:

```powershell
git add apps/api
git commit -m "feat: add tts job queue"
```

---

### Task 6: Voice Library Endpoint

**Files:**
- Create: `apps/api/tts_api/routes/voices.py`
- Modify: `apps/api/tts_api/main.py`
- Modify: `apps/api/tts_api/schemas.py`
- Test: `apps/api/tests/test_voices.py`

- [ ] **Step 1: Write failing voice tests**

Create `apps/api/tests/test_voices.py`:

```python
from fastapi.testclient import TestClient
from tts_api.main import app


def test_list_voices_returns_builtin_default():
    client = TestClient(app)
    response = client.get("/v1/tts/voices")

    assert response.status_code == 200
    voices = response.json()
    assert voices[0]["id"] == "default"
    assert voices[0]["authorization_status"] == "built_in"


def test_create_voice_preset_records_authorization():
    client = TestClient(app)
    response = client.post(
        "/v1/tts/voices",
        json={
            "name": "Test Voice",
            "reference_audio": "D:/voices/test.wav",
            "reference_text": "This is a test.",
            "authorization_status": "authorized"
        },
    )

    assert response.status_code == 200
    assert response.json()["name"] == "Test Voice"
    assert response.json()["authorization_status"] == "authorized"
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```powershell
cd apps/api
uv run pytest tests/test_voices.py -v
```

Expected:

```text
404 Not Found for /v1/tts/voices
```

- [ ] **Step 3: Add voice schemas**

Append to `apps/api/tts_api/schemas.py`:

```python
class VoiceInfo(BaseModel):
    id: str
    name: str
    reference_audio: str | None = None
    reference_text: str | None = None
    authorization_status: str


class CreateVoiceRequest(BaseModel):
    name: str = Field(min_length=1)
    reference_audio: str | None = None
    reference_text: str | None = None
    authorization_status: str
```

- [ ] **Step 4: Add voice route**

Create `apps/api/tts_api/routes/voices.py`:

```python
from uuid import uuid4
from fastapi import APIRouter
from tts_api.schemas import CreateVoiceRequest, VoiceInfo

router = APIRouter()

voices: dict[str, VoiceInfo] = {
    "default": VoiceInfo(
        id="default",
        name="Default",
        authorization_status="built_in",
    )
}


@router.get("/v1/tts/voices", response_model=list[VoiceInfo])
def list_voices() -> list[VoiceInfo]:
    return list(voices.values())


@router.post("/v1/tts/voices", response_model=VoiceInfo)
def create_voice(request: CreateVoiceRequest) -> VoiceInfo:
    voice = VoiceInfo(
        id=uuid4().hex,
        name=request.name,
        reference_audio=request.reference_audio,
        reference_text=request.reference_text,
        authorization_status=request.authorization_status,
    )
    voices[voice.id] = voice
    return voice
```

- [ ] **Step 5: Register voice route**

Modify `apps/api/tts_api/main.py`:

```python
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from tts_api.config import get_settings
from tts_api.routes import health, jobs, models, speech, voices


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(title="Open TTS Desktop API", version="0.1.0")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.mount("/outputs", StaticFiles(directory=settings.output_dir), name="outputs")
    app.include_router(health.router)
    app.include_router(models.router)
    app.include_router(speech.router)
    app.include_router(jobs.router)
    app.include_router(voices.router)
    return app


app = create_app()
```

- [ ] **Step 6: Run voice tests**

Run:

```powershell
cd apps/api
uv run pytest tests/test_voices.py -v
```

Expected:

```text
tests/test_voices.py::test_list_voices_returns_builtin_default PASSED
tests/test_voices.py::test_create_voice_preset_records_authorization PASSED
```

- [ ] **Step 7: Commit**

Run:

```powershell
git add apps/api
git commit -m "feat: add local voice library api"
```

---

### Task 7: VoxCPM2 Adapter Skeleton

**Files:**
- Create: `apps/api/tts_api/adapters/voxcpm2.py`
- Modify: `apps/api/tts_api/routes/speech.py`
- Test: `apps/api/tests/test_voxcpm2_adapter.py`

- [ ] **Step 1: Write failing adapter command test**

Create `apps/api/tests/test_voxcpm2_adapter.py`:

```python
from pathlib import Path
from tts_api.adapters.voxcpm2 import VoxCpm2Adapter
from tts_api.config import Settings
from tts_api.schemas import SpeechRequest


def test_voxcpm2_adapter_builds_expected_command(tmp_path: Path):
    settings = Settings(output_dir=tmp_path)
    adapter = VoxCpm2Adapter(settings=settings, python_executable="D:/runtime/voxcpm2/python.exe")
    request = SpeechRequest(
        model="voxcpm2",
        input="hello",
        voice_prompt="young warm voice",
        reference_audio="D:/voices/ref.wav",
    )

    command, output_path = adapter.build_command(request)

    assert command[0] == "D:/runtime/voxcpm2/python.exe"
    assert "tools/run_voxcpm2.py" in command
    assert "--text" in command
    assert "hello" in command
    assert "--voice-prompt" in command
    assert "young warm voice" in command
    assert "--reference-audio" in command
    assert "D:/voices/ref.wav" in command
    assert output_path.suffix == ".wav"
```

- [ ] **Step 2: Run test to verify failure**

Run:

```powershell
cd apps/api
uv run pytest tests/test_voxcpm2_adapter.py -v
```

Expected:

```text
ModuleNotFoundError: No module named 'tts_api.adapters.voxcpm2'
```

- [ ] **Step 3: Add VoxCPM2 adapter command builder**

Create `apps/api/tts_api/adapters/voxcpm2.py`:

```python
import subprocess
from pathlib import Path
from tts_api.adapters.base import TtsAdapter
from tts_api.audio import create_output_path
from tts_api.config import Settings, get_settings
from tts_api.schemas import SpeechRequest, SpeechResult


class VoxCpm2Adapter(TtsAdapter):
    def __init__(self, settings: Settings | None = None, python_executable: str = "python"):
        self.settings = settings or get_settings()
        self.python_executable = python_executable

    def build_command(self, request: SpeechRequest) -> tuple[list[str], Path]:
        output_path = create_output_path(self.settings.output_dir, ".wav")
        command = [
            self.python_executable,
            "tools/run_voxcpm2.py",
            "--text",
            request.input,
            "--output",
            str(output_path),
        ]
        if request.voice_prompt:
            command.extend(["--voice-prompt", request.voice_prompt])
        if request.reference_audio:
            command.extend(["--reference-audio", request.reference_audio])
        if request.reference_text:
            command.extend(["--reference-text", request.reference_text])
        return command, output_path

    def synthesize(self, request: SpeechRequest) -> SpeechResult:
        command, output_path = self.build_command(request)
        completed = subprocess.run(command, check=True, capture_output=True, text=True)
        if completed.returncode != 0:
            raise RuntimeError(completed.stderr)
        return SpeechResult(
            audio_url=f"/outputs/{output_path.name}",
            file_path=str(output_path),
            model=request.model,
            sample_rate=48000,
            duration_seconds=0.0,
        )
```

- [ ] **Step 4: Wire adapter resolver**

Modify `apps/api/tts_api/routes/speech.py`:

```python
from fastapi import APIRouter
from tts_api.adapters.f5_tts import F5TtsAdapter
from tts_api.adapters.mock import MockTtsAdapter
from tts_api.adapters.voxcpm2 import VoxCpm2Adapter
from tts_api.config import get_settings
from tts_api.errors import unknown_model_error, unsupported_adapter_error
from tts_api.registry import ModelRegistry
from tts_api.schemas import SpeechRequest, SpeechResult

router = APIRouter()


def synthesize_with_registered_adapter(request: SpeechRequest) -> SpeechResult:
    settings = get_settings()
    registry = ModelRegistry(settings.model_registry_path)
    try:
        model = registry.get_model(request.model)
    except KeyError:
        raise unknown_model_error(request.model)

    if model.adapter == "mock":
        return MockTtsAdapter(settings=settings).synthesize(request)
    if model.adapter == "voxcpm2":
        return VoxCpm2Adapter(settings=settings).synthesize(request)
    if model.adapter == "f5_tts":
        return F5TtsAdapter(settings=settings).synthesize(request)

    raise unsupported_adapter_error(model.adapter)


@router.post("/v1/audio/speech", response_model=SpeechResult)
def openai_compatible_speech(request: SpeechRequest) -> SpeechResult:
    return synthesize_with_registered_adapter(request)


@router.post("/v1/tts/speech", response_model=SpeechResult)
def tts_speech(request: SpeechRequest) -> SpeechResult:
    return synthesize_with_registered_adapter(request)
```

- [ ] **Step 5: Run adapter test**

Run:

```powershell
cd apps/api
uv run pytest tests/test_voxcpm2_adapter.py -v
```

Expected:

```text
tests/test_voxcpm2_adapter.py::test_voxcpm2_adapter_builds_expected_command PASSED
```

- [ ] **Step 6: Commit**

Run:

```powershell
git add apps/api
git commit -m "feat: add voxcpm2 adapter skeleton"
```

---

### Task 8: F5-TTS Adapter Skeleton

**Files:**
- Create: `apps/api/tts_api/adapters/f5_tts.py`
- Modify: `apps/api/tts_api/routes/speech.py`
- Test: `apps/api/tests/test_f5_tts_adapter.py`

- [ ] **Step 1: Write failing F5-TTS command test**

Create `apps/api/tests/test_f5_tts_adapter.py`:

```python
from pathlib import Path
from tts_api.adapters.f5_tts import F5TtsAdapter
from tts_api.config import Settings
from tts_api.schemas import SpeechRequest


def test_f5_tts_adapter_builds_expected_command(tmp_path: Path):
    settings = Settings(output_dir=tmp_path)
    adapter = F5TtsAdapter(settings=settings, python_executable="D:/runtime/f5/python.exe")
    request = SpeechRequest(
        model="f5-tts",
        input="hello",
        reference_audio="D:/voices/ref.wav",
        reference_text="reference words",
    )

    command, output_path = adapter.build_command(request)

    assert command[0] == "D:/runtime/f5/python.exe"
    assert "-m" in command
    assert "f5_tts.infer.infer_cli" in command
    assert "--gen_text" in command
    assert "hello" in command
    assert "--ref_audio" in command
    assert "D:/voices/ref.wav" in command
    assert "--ref_text" in command
    assert "reference words" in command
    assert output_path.suffix == ".wav"
```

- [ ] **Step 2: Run test to verify failure**

Run:

```powershell
cd apps/api
uv run pytest tests/test_f5_tts_adapter.py -v
```

Expected:

```text
ModuleNotFoundError: No module named 'tts_api.adapters.f5_tts'
```

- [ ] **Step 3: Add F5-TTS adapter command builder**

Create `apps/api/tts_api/adapters/f5_tts.py`:

```python
import subprocess
from pathlib import Path
from tts_api.adapters.base import TtsAdapter
from tts_api.audio import create_output_path
from tts_api.config import Settings, get_settings
from tts_api.schemas import SpeechRequest, SpeechResult


class F5TtsAdapter(TtsAdapter):
    def __init__(self, settings: Settings | None = None, python_executable: str = "python"):
        self.settings = settings or get_settings()
        self.python_executable = python_executable

    def build_command(self, request: SpeechRequest) -> tuple[list[str], Path]:
        output_path = create_output_path(self.settings.output_dir, ".wav")
        command = [
            self.python_executable,
            "-m",
            "f5_tts.infer.infer_cli",
            "--gen_text",
            request.input,
            "--output_file",
            str(output_path),
        ]
        if request.reference_audio:
            command.extend(["--ref_audio", request.reference_audio])
        if request.reference_text:
            command.extend(["--ref_text", request.reference_text])
        return command, output_path

    def synthesize(self, request: SpeechRequest) -> SpeechResult:
        command, output_path = self.build_command(request)
        completed = subprocess.run(command, check=True, capture_output=True, text=True)
        if completed.returncode != 0:
            raise RuntimeError(completed.stderr)
        return SpeechResult(
            audio_url=f"/outputs/{output_path.name}",
            file_path=str(output_path),
            model=request.model,
            sample_rate=24000,
            duration_seconds=0.0,
        )
```

- [ ] **Step 4: Ensure speech route imports F5-TTS adapter**

Verify `apps/api/tts_api/routes/speech.py` contains:

```python
from tts_api.adapters.f5_tts import F5TtsAdapter
```

Verify `synthesize_with_registered_adapter` contains:

```python
if model.adapter == "f5_tts":
    return F5TtsAdapter(settings=settings).synthesize(request)
```

- [ ] **Step 5: Run F5-TTS adapter test**

Run:

```powershell
cd apps/api
uv run pytest tests/test_f5_tts_adapter.py -v
```

Expected:

```text
tests/test_f5_tts_adapter.py::test_f5_tts_adapter_builds_expected_command PASSED
```

- [ ] **Step 6: Commit**

Run:

```powershell
git add apps/api
git commit -m "feat: add f5 tts adapter skeleton"
```

---

### Task 9: Desktop App Shell

**Files:**
- Create: `apps/desktop/package.json`
- Create: `apps/desktop/index.html`
- Create: `apps/desktop/electron/main.ts`
- Create: `apps/desktop/src/main.tsx`
- Create: `apps/desktop/src/types.ts`
- Create: `apps/desktop/src/api.ts`
- Create: `apps/desktop/src/App.tsx`
- Create: `apps/desktop/src/styles.css`

- [ ] **Step 1: Create desktop package metadata**

Create `apps/desktop/package.json`:

```json
{
  "name": "open-tts-desktop",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "electron": "electron .",
    "build": "vite build"
  },
  "main": "electron/main.ts",
  "dependencies": {
    "@vitejs/plugin-react": "^4.3.0",
    "vite": "^5.4.0",
    "typescript": "^5.5.0",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "electron": "^31.0.0",
    "lucide-react": "^0.468.0"
  },
  "devDependencies": {}
}
```

- [ ] **Step 2: Create Electron entry**

Create `apps/desktop/electron/main.ts`:

```typescript
import { app, BrowserWindow } from "electron";

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    title: "Open TTS Desktop",
    webPreferences: {
      contextIsolation: true
    }
  });

  win.loadURL("http://localhost:5173");
}

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
```

- [ ] **Step 3: Create Vite React entry**

Create `apps/desktop/index.html`:

```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Open TTS Desktop</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

Create `apps/desktop/src/main.tsx`:

```typescript
import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
```

- [ ] **Step 4: Add API types and client**

Create `apps/desktop/src/types.ts`:

```typescript
export type ModelInfo = {
  id: string;
  display_name: string;
  priority: string;
  source_url: string;
  code_license: string;
  weights_license: string;
  commercial_use: "allowed" | "restricted" | "unknown";
  recommended_vram_gb: number;
  features: string[];
  native_sample_rate: number;
  adapter: string;
};

export type SpeechResult = {
  audio_url: string;
  file_path: string;
  model: string;
  sample_rate: number;
  duration_seconds: number;
};
```

Create `apps/desktop/src/api.ts`:

```typescript
import type { ModelInfo, SpeechResult } from "./types";

const API_BASE = "http://127.0.0.1:8765";

export async function fetchModels(): Promise<ModelInfo[]> {
  const response = await fetch(`${API_BASE}/v1/tts/models`);
  if (!response.ok) throw new Error(`Failed to load models: ${response.status}`);
  return response.json();
}

export async function generateSpeech(model: string, input: string): Promise<SpeechResult> {
  const response = await fetch(`${API_BASE}/v1/audio/speech`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, input, response_format: "wav" })
  });
  if (!response.ok) throw new Error(`Failed to generate speech: ${response.status}`);
  return response.json();
}

export function toAudioUrl(audioUrl: string): string {
  return `${API_BASE}${audioUrl}`;
}
```

- [ ] **Step 5: Add desktop UI**

Create `apps/desktop/src/App.tsx`:

```typescript
import { Play, RefreshCw, Wand2 } from "lucide-react";
import { useEffect, useState } from "react";
import { fetchModels, generateSpeech, toAudioUrl } from "./api";
import type { ModelInfo, SpeechResult } from "./types";

export function App() {
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [selectedModel, setSelectedModel] = useState("mock-tts");
  const [input, setInput] = useState("你好，这是一段本地开源 TTS 生成测试。");
  const [result, setResult] = useState<SpeechResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadModels() {
    setError(null);
    try {
      const loaded = await fetchModels();
      setModels(loaded);
      if (loaded.length > 0 && !loaded.some((model) => model.id === selectedModel)) {
        setSelectedModel(loaded[0].id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "无法连接本地 API");
    }
  }

  async function onGenerate() {
    setLoading(true);
    setError(null);
    try {
      const generated = await generateSpeech(selectedModel, input);
      setResult(generated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "生成失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadModels();
  }, []);

  return (
    <main className="shell">
      <aside className="sidebar">
        <div className="brand">Open TTS</div>
        <button className="nav active">生成</button>
        <button className="nav">模型</button>
        <button className="nav">声音</button>
        <button className="nav">任务</button>
        <button className="nav">API</button>
      </aside>
      <section className="workspace">
        <header className="topbar">
          <div>
            <h1>语音生成</h1>
            <p>本地模型，一键生成，对外提供 localhost API。</p>
          </div>
          <button className="iconButton" onClick={loadModels} title="刷新模型">
            <RefreshCw size={18} />
          </button>
        </header>

        <section className="panel">
          <label>
            模型
            <select value={selectedModel} onChange={(event) => setSelectedModel(event.target.value)}>
              {models.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.display_name}
                </option>
              ))}
            </select>
          </label>

          <label>
            文本
            <textarea value={input} onChange={(event) => setInput(event.target.value)} />
          </label>

          <button className="primary" onClick={onGenerate} disabled={loading || input.trim().length === 0}>
            <Wand2 size={18} />
            {loading ? "生成中" : "生成语音"}
          </button>

          {error && <div className="error">{error}</div>}

          {result && (
            <div className="result">
              <div className="resultHeader">
                <Play size={18} />
                <span>{result.model}</span>
              </div>
              <audio controls src={toAudioUrl(result.audio_url)} />
              <code>{result.file_path}</code>
            </div>
          )}
        </section>
      </section>
    </main>
  );
}
```

- [ ] **Step 6: Add desktop styles**

Create `apps/desktop/src/styles.css`:

```css
* {
  box-sizing: border-box;
}

body {
  margin: 0;
  font-family: Inter, "Segoe UI", Arial, sans-serif;
  background: #f7f5ef;
  color: #171717;
}

button,
select,
textarea {
  font: inherit;
}

.shell {
  min-height: 100vh;
  display: grid;
  grid-template-columns: 220px 1fr;
}

.sidebar {
  background: #1f2937;
  color: #ffffff;
  padding: 20px 14px;
}

.brand {
  font-size: 20px;
  font-weight: 700;
  margin: 4px 8px 24px;
}

.nav {
  width: 100%;
  height: 40px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: #cbd5e1;
  text-align: left;
  padding: 0 12px;
  margin-bottom: 6px;
  cursor: pointer;
}

.nav.active,
.nav:hover {
  background: #374151;
  color: #ffffff;
}

.workspace {
  padding: 28px;
}

.topbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
}

h1 {
  margin: 0 0 6px;
  font-size: 28px;
}

p {
  margin: 0;
  color: #64748b;
}

.iconButton {
  width: 38px;
  height: 38px;
  border: 1px solid #d6d3d1;
  border-radius: 6px;
  background: #ffffff;
  display: grid;
  place-items: center;
  cursor: pointer;
}

.panel {
  max-width: 860px;
  background: #ffffff;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 20px;
}

label {
  display: grid;
  gap: 8px;
  margin-bottom: 16px;
  color: #334155;
  font-weight: 600;
}

select,
textarea {
  border: 1px solid #d6d3d1;
  border-radius: 6px;
  padding: 10px 12px;
  background: #ffffff;
  color: #111827;
}

textarea {
  min-height: 180px;
  resize: vertical;
  line-height: 1.6;
}

.primary {
  height: 42px;
  border: 0;
  border-radius: 6px;
  background: #0f766e;
  color: #ffffff;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 0 16px;
  cursor: pointer;
}

.primary:disabled {
  background: #94a3b8;
  cursor: default;
}

.error {
  margin-top: 16px;
  color: #b91c1c;
}

.result {
  margin-top: 18px;
  padding-top: 18px;
  border-top: 1px solid #e5e7eb;
  display: grid;
  gap: 12px;
}

.resultHeader {
  display: flex;
  gap: 8px;
  align-items: center;
  font-weight: 700;
}

audio {
  width: 100%;
}

code {
  color: #475569;
  overflow-wrap: anywhere;
}
```

- [ ] **Step 7: Run desktop dev server**

Run:

```powershell
cd apps/desktop
npm install
npm run dev
```

Expected:

```text
Local: http://localhost:5173/
```

- [ ] **Step 8: Commit**

Run:

```powershell
git add apps/desktop
git commit -m "feat: add desktop generation shell"
```

---

### Task 10: API Examples And Manual Verification

**Files:**
- Create: `docs/api-examples.md`

- [ ] **Step 1: Add API examples**

Create `docs/api-examples.md`:

```markdown
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
```

- [ ] **Step 2: Run all backend tests**

Run:

```powershell
cd apps/api
uv run pytest -v
```

Expected:

```text
PASSED
```

- [ ] **Step 3: Run API service**

Run:

```powershell
cd apps/api
uv run uvicorn tts_api.main:app --reload --port 8765
```

Expected:

```text
Uvicorn running on http://127.0.0.1:8765
```

- [ ] **Step 4: Verify speech endpoint manually**

Run in a second terminal:

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

Expected response shape:

```json
{
  "audio_url": "/outputs/<generated>.wav",
  "file_path": "D:\\code\\tts\\data\\outputs\\<generated>.wav",
  "model": "mock-tts",
  "sample_rate": 24000,
  "duration_seconds": 0.6
}
```

- [ ] **Step 5: Commit**

Run:

```powershell
git add docs/api-examples.md
git commit -m "docs: add local tts api examples"
```

---

## Follow-On Plan After This MVP

After the above tasks pass, create separate plans for:

1. Runtime installer and repair flow.
2. Real VoxCPM2 runner script and environment provisioning.
3. Real F5-TTS runner script and environment provisioning.
4. Qwen3-TTS adapter.
5. CosyVoice 3 adapter.
6. IndexTTS2 adapter with license warning UX.
7. GPT-SoVITS adapter and optional fine-tuning launcher.
8. Long-text segmentation, loudness normalization, and FFmpeg concatenation.
9. Persistent database for jobs, voices, model install status, and history.
10. Desktop packaging for Windows.

Each follow-on plan should preserve the same adapter contract and public API introduced here.

## Verification Summary

At the end of this plan, the app should support:

- `GET /v1/health`
- `GET /v1/tts/models`
- `GET /v1/tts/voices`
- `POST /v1/tts/voices`
- `POST /v1/audio/speech`
- `POST /v1/tts/speech`
- `POST /v1/tts/jobs`
- `GET /v1/tts/jobs/{job_id}`
- A deterministic mock WAV generation flow
- VoxCPM2 and F5-TTS adapter command skeletons
- A desktop UI that can call the local API and play generated audio

Run this final verification:

```powershell
cd apps/api
uv run pytest -v
```

Then run:

```powershell
cd apps/api
uv run uvicorn tts_api.main:app --reload --port 8765
```

In another terminal:

```powershell
cd apps/desktop
npm run dev
```

Open:

```text
http://localhost:5173
```
