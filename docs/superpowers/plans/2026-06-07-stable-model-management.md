# Stable Model Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a stable model management layer where each TTS model has one active local instance with persistent profile data, health checks, and desktop management UI.

**Architecture:** Add a backend model instance service that derives default profiles from existing settings, persists profile overrides to user settings, and exposes health-check endpoints. Generation adapters continue using their existing code paths, but runtime settings are resolved from active model profiles so the desktop can manage models as stable assets instead of raw directory fields. The desktop replaces the flat model-path settings section with a Model Center that shows readiness, repair hints, and path controls for each model.

**Tech Stack:** FastAPI, Pydantic, pytest, React 18, TypeScript, Vite, Electron, Playwright-based Electron tests.

---

## File Structure

Backend files:

- Create `apps/api/tts_api/model_instances.py`: profile models, default profile creation, persistence helpers, and conversion from active profiles to runtime settings.
- Create `apps/api/tts_api/model_health.py`: model-specific non-loading checks for IndexTTS2, VoxCPM2, GPT-SoVITS, and F5-TTS.
- Create `apps/api/tts_api/routes/model_instances.py`: REST endpoints for listing, updating, and checking model profiles.
- Modify `apps/api/tts_api/config.py`: add `model_instances` to user settings and expose it in serialized settings.
- Modify `apps/api/tts_api/main.py`: register the new model instance router.
- Modify `apps/api/tts_api/routes/speech.py`: resolve active model profile before adapter selection and update `last_success_at` after successful generation.
- Modify `apps/api/tts_api/routes/system.py`: include model instance health summaries.

Backend tests:

- Create `apps/api/tests/test_model_instances.py`: profile defaults, persistence, update endpoint, health checks, and generation settings resolution.
- Modify `apps/api/tests/test_system_status.py`: assert model instance summaries are included.
- Modify `apps/api/tests/test_speech_api.py`: assert generation uses profile-derived paths where possible.

Desktop files:

- Modify `apps/desktop/src/types.ts`: add model instance and health-check types.
- Modify `apps/desktop/src/api.ts`: add model instance API functions.
- Modify `apps/desktop/src/App.tsx`: add Model Center state, fetch/update/check handlers, readiness gating, and settings UI replacement.
- Modify `apps/desktop/src/styles.css`: add Model Center card and check-result styles.

Desktop tests:

- Add or modify Electron tests under `apps/desktop/electron/*.test.cjs` only if IPC behavior changes. The current plan uses existing file-picker IPC, so the core verification is `npm run build` plus existing Electron tests.

---

### Task 1: Backend Model Instance Profiles

**Files:**
- Create: `apps/api/tts_api/model_instances.py`
- Modify: `apps/api/tts_api/config.py`
- Test: `apps/api/tests/test_model_instances.py`

- [ ] **Step 1: Write failing tests for default profiles**

Create `apps/api/tests/test_model_instances.py` with these initial tests:

```python
from pathlib import Path

from tts_api.config import Settings
from tts_api.model_instances import (
    ModelInstanceStatus,
    RuntimeType,
    build_default_model_instances,
    merge_model_instance_updates,
)


def test_default_model_instances_are_created_from_settings(tmp_path: Path):
    settings = Settings(
        indextts2_root=tmp_path / "IndexTTS2",
        voxcpm2_root=tmp_path / "VoxCPM2",
        voxcpm2_api_host="127.0.0.1",
        voxcpm2_api_port=8000,
        gptsovits_root=tmp_path / "GPT-SoVITS",
        gptsovits_api_host="127.0.0.1",
        gptsovits_api_port=9880,
    )

    instances = build_default_model_instances(settings)
    by_id = {instance.model_id: instance for instance in instances}

    assert set(by_id) == {"indextts2", "voxcpm2", "gptsovits", "f5-tts"}
    assert by_id["indextts2"].runtime_type == RuntimeType.worker_lazy_pack
    assert by_id["indextts2"].root_path == tmp_path / "IndexTTS2"
    assert by_id["voxcpm2"].runtime_type == RuntimeType.lazy_pack_api
    assert by_id["voxcpm2"].api_host == "127.0.0.1"
    assert by_id["voxcpm2"].api_port == 8000
    assert by_id["gptsovits"].runtime_type == RuntimeType.lazy_pack_api
    assert by_id["gptsovits"].api_port == 9880
    assert by_id["f5-tts"].runtime_type == RuntimeType.reserved
    assert by_id["f5-tts"].enabled is False
    assert by_id["gptsovits"].status == ModelInstanceStatus.untested


def test_model_instance_updates_override_defaults(tmp_path: Path):
    settings = Settings(indextts2_root=tmp_path / "IndexTTS2")
    updated_root = tmp_path / "stable-index"

    merged = merge_model_instance_updates(
        build_default_model_instances(settings),
        {
            "indextts2": {
                "root_path": str(updated_root),
                "enabled": False,
                "status": "disabled",
                "last_error": "manually disabled",
            }
        },
    )
    by_id = {instance.model_id: instance for instance in merged}

    assert by_id["indextts2"].root_path == updated_root
    assert by_id["indextts2"].enabled is False
    assert by_id["indextts2"].status == ModelInstanceStatus.disabled
    assert by_id["indextts2"].last_error == "manually disabled"
```

- [ ] **Step 2: Run tests to confirm they fail**

Run:

```powershell
.\.venv\Scripts\python.exe -m pytest tests/test_model_instances.py -q
```

Expected result: collection fails with `ModuleNotFoundError: No module named 'tts_api.model_instances'`.

- [ ] **Step 3: Implement profile models and default creation**

Create `apps/api/tts_api/model_instances.py`:

```python
from datetime import datetime, timezone
from enum import StrEnum
from pathlib import Path
from typing import Any

from pydantic import BaseModel, Field

from tts_api.config import Settings


class RuntimeType(StrEnum):
    worker_lazy_pack = "worker_lazy_pack"
    lazy_pack_api = "lazy_pack_api"
    reserved = "reserved"


class ModelInstanceStatus(StrEnum):
    ready = "ready"
    untested = "untested"
    missing = "missing"
    broken = "broken"
    disabled = "disabled"


class ModelInstanceProfile(BaseModel):
    model_id: str
    display_name: str
    enabled: bool = True
    runtime_type: RuntimeType
    root_path: Path | None = None
    api_host: str | None = None
    api_port: int | None = Field(default=None, ge=1024, le=65535)
    status: ModelInstanceStatus = ModelInstanceStatus.untested
    last_health_check_at: datetime | None = None
    last_success_at: datetime | None = None
    last_error: str | None = None

    def serializable(self) -> dict[str, Any]:
        payload = self.model_dump(mode="json")
        if self.root_path is not None:
            payload["root_path"] = str(self.root_path)
        return payload


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def build_default_model_instances(settings: Settings) -> list[ModelInstanceProfile]:
    return [
        ModelInstanceProfile(
            model_id="indextts2",
            display_name="IndexTTS2",
            runtime_type=RuntimeType.worker_lazy_pack,
            root_path=settings.indextts2_root,
        ),
        ModelInstanceProfile(
            model_id="voxcpm2",
            display_name="VoxCPM2",
            runtime_type=RuntimeType.lazy_pack_api,
            root_path=settings.voxcpm2_root,
            api_host=settings.voxcpm2_api_host,
            api_port=settings.voxcpm2_api_port,
        ),
        ModelInstanceProfile(
            model_id="gptsovits",
            display_name="GPT-SoVITS",
            runtime_type=RuntimeType.lazy_pack_api,
            root_path=settings.gptsovits_root,
            api_host=settings.gptsovits_api_host,
            api_port=settings.gptsovits_api_port,
        ),
        ModelInstanceProfile(
            model_id="f5-tts",
            display_name="F5-TTS",
            enabled=False,
            runtime_type=RuntimeType.reserved,
            root_path=None,
            status=ModelInstanceStatus.disabled,
            last_error="F5-TTS adapter is reserved and not connected yet.",
        ),
    ]


def _coerce_profile_update(model_id: str, display_name: str, runtime_type: RuntimeType, value: dict) -> ModelInstanceProfile:
    return ModelInstanceProfile.model_validate(
        {
            "model_id": model_id,
            "display_name": value.get("display_name", display_name),
            "runtime_type": value.get("runtime_type", runtime_type),
            **value,
        }
    )


def merge_model_instance_updates(
    defaults: list[ModelInstanceProfile],
    updates: dict[str, dict] | None,
) -> list[ModelInstanceProfile]:
    if not updates:
        return defaults
    merged: list[ModelInstanceProfile] = []
    for default in defaults:
        update = updates.get(default.model_id)
        if update is None:
            merged.append(default)
            continue
        merged.append(
            _coerce_profile_update(
                default.model_id,
                default.display_name,
                default.runtime_type,
                {**default.serializable(), **update},
            )
        )
    return merged
```

- [ ] **Step 4: Add model instance settings support**

Modify `apps/api/tts_api/config.py`:

```python
USER_SETTING_KEYS = {
    "api_host",
    "api_port",
    "output_dir",
    "indextts2_root",
    "indextts2_idle_timeout_seconds",
    "voxcpm2_root",
    "voxcpm2_api_host",
    "voxcpm2_api_port",
    "gptsovits_root",
    "gptsovits_api_host",
    "gptsovits_api_port",
    "model_instances",
}
```

Add this field to `Settings`:

```python
    model_instances: dict[str, dict] = Field(default_factory=dict)
```

Add this key to `serialize_settings`:

```python
        "model_instances": settings.model_instances,
```

- [ ] **Step 5: Run tests for Task 1**

Run:

```powershell
.\.venv\Scripts\python.exe -m pytest tests/test_model_instances.py -q
```

Expected result: the two tests pass.

---

### Task 2: Backend Health Checks

**Files:**
- Create: `apps/api/tts_api/model_health.py`
- Modify: `apps/api/tts_api/model_instances.py`
- Test: `apps/api/tests/test_model_instances.py`

- [ ] **Step 1: Add failing tests for model health checks**

Append these tests to `apps/api/tests/test_model_instances.py`:

```python
from tts_api.model_health import check_model_instance


def test_gptsovits_health_check_passes_for_complete_lazy_pack(tmp_path: Path):
    root = tmp_path / "GPT-SoVITS"
    (root / "runtime").mkdir(parents=True)
    (root / "runtime" / "python.exe").write_text("python", encoding="utf-8")
    (root / "api_v2.py").write_text("api", encoding="utf-8")
    (root / "GPT_SoVITS" / "configs").mkdir(parents=True)
    (root / "GPT_SoVITS" / "configs" / "tts_infer.yaml").write_text("config", encoding="utf-8")
    profile = ModelInstanceProfile(
        model_id="gptsovits",
        display_name="GPT-SoVITS",
        runtime_type=RuntimeType.lazy_pack_api,
        root_path=root,
        api_host="127.0.0.1",
        api_port=9880,
    )

    result = check_model_instance(profile)

    assert result.status == ModelInstanceStatus.ready
    assert result.repair_hint is None
    assert {check.id: check.passed for check in result.checks} == {
        "root": True,
        "python": True,
        "entrypoint": True,
        "config": True,
    }


def test_gptsovits_health_check_reports_missing_python(tmp_path: Path):
    root = tmp_path / "GPT-SoVITS"
    root.mkdir()
    profile = ModelInstanceProfile(
        model_id="gptsovits",
        display_name="GPT-SoVITS",
        runtime_type=RuntimeType.lazy_pack_api,
        root_path=root,
        api_host="127.0.0.1",
        api_port=9880,
    )

    result = check_model_instance(profile)

    assert result.status == ModelInstanceStatus.broken
    assert "runtime" in result.repair_hint
    assert {check.id: check.passed for check in result.checks}["python"] is False


def test_disabled_profile_health_check_stays_disabled(tmp_path: Path):
    profile = ModelInstanceProfile(
        model_id="f5-tts",
        display_name="F5-TTS",
        enabled=False,
        runtime_type=RuntimeType.reserved,
        status=ModelInstanceStatus.disabled,
    )

    result = check_model_instance(profile)

    assert result.status == ModelInstanceStatus.disabled
    assert result.repair_hint == "模型已禁用。"
```

- [ ] **Step 2: Run tests to confirm health module is missing**

Run:

```powershell
.\.venv\Scripts\python.exe -m pytest tests/test_model_instances.py -q
```

Expected result: fails with `ModuleNotFoundError: No module named 'tts_api.model_health'`.

- [ ] **Step 3: Implement shared health result models**

Add these classes to `apps/api/tts_api/model_instances.py`:

```python
class ModelHealthCheck(BaseModel):
    id: str
    label: str
    passed: bool
    detail: str | None = None


class ModelHealthResult(BaseModel):
    model_id: str
    status: ModelInstanceStatus
    checks: list[ModelHealthCheck]
    repair_hint: str | None = None
    checked_at: datetime = Field(default_factory=utc_now)
```

- [ ] **Step 4: Implement model-specific health checks**

Create `apps/api/tts_api/model_health.py`:

```python
from pathlib import Path

from tts_api.model_instances import (
    ModelHealthCheck,
    ModelHealthResult,
    ModelInstanceProfile,
    ModelInstanceStatus,
)


def _path_check(identifier: str, label: str, path: Path | None, must_be_dir: bool = False) -> ModelHealthCheck:
    if path is None:
        return ModelHealthCheck(id=identifier, label=label, passed=False, detail="未配置路径")
    exists = path.is_dir() if must_be_dir else path.exists()
    return ModelHealthCheck(id=identifier, label=label, passed=exists, detail=str(path))


def _status_from_checks(profile: ModelInstanceProfile, checks: list[ModelHealthCheck]) -> ModelInstanceStatus:
    if not profile.enabled:
        return ModelInstanceStatus.disabled
    root_check = next((check for check in checks if check.id == "root"), None)
    if root_check is not None and not root_check.passed:
        return ModelInstanceStatus.missing
    return ModelInstanceStatus.ready if all(check.passed for check in checks) else ModelInstanceStatus.broken


def _repair_hint(profile: ModelInstanceProfile, status: ModelInstanceStatus, checks: list[ModelHealthCheck]) -> str | None:
    if status == ModelInstanceStatus.ready:
        return None
    if status == ModelInstanceStatus.disabled:
        return "模型已禁用。"
    failed = next((check for check in checks if not check.passed), None)
    if failed is None:
        return "模型配置需要重新检查。"
    if profile.model_id == "gptsovits" and failed.id == "python":
        return "当前目录不像 GPT-SoVITS 懒人包，请重新选择包含 runtime 的目录。"
    if profile.model_id == "gptsovits" and failed.id == "entrypoint":
        return "未找到 api_v2.py，请选择完整的 GPT-SoVITS 目录。"
    if profile.model_id == "gptsovits" and failed.id == "config":
        return "未找到 GPT_SoVITS/configs/tts_infer.yaml，请选择完整的 GPT-SoVITS 目录。"
    if profile.model_id == "voxcpm2" and failed.id == "python":
        return "当前目录不像 VoxCPM2 懒人包，请重新选择包含 MWAI/python.exe 的目录。"
    if profile.model_id == "indextts2" and failed.id == "checkpoints":
        return "未找到 checkpoints，请选择完整的 IndexTTS2 目录。"
    return f"{failed.label}检查未通过，请重新选择模型目录。"


def _check_indextts2(profile: ModelInstanceProfile) -> list[ModelHealthCheck]:
    root = profile.root_path
    source = root / "Index-TTS" if root else None
    python_path = root / "WPy64-310110" / "python-3.10.11.amd64" / "python.exe" if root else None
    return [
        _path_check("root", "模型目录", root, must_be_dir=True),
        _path_check("python", "Python 运行时", python_path),
        _path_check("source", "源码目录", source, must_be_dir=True),
        _path_check("checkpoints", "权重目录", source / "checkpoints" if source else None, must_be_dir=True),
    ]


def _check_voxcpm2(profile: ModelInstanceProfile) -> list[ModelHealthCheck]:
    root = profile.root_path
    return [
        _path_check("root", "模型目录", root, must_be_dir=True),
        _path_check("python", "Python 运行时", root / "MWAI" / "python.exe" if root else None),
        _path_check("entrypoint", "API 启动脚本", root / "api.py" if root else None),
        _path_check("models", "模型文件目录", root / "models" if root else None, must_be_dir=True),
    ]


def _check_gptsovits(profile: ModelInstanceProfile) -> list[ModelHealthCheck]:
    root = profile.root_path
    return [
        _path_check("root", "模型目录", root, must_be_dir=True),
        _path_check("python", "Python 运行时", root / "runtime" / "python.exe" if root else None),
        _path_check("entrypoint", "API 启动脚本", root / "api_v2.py" if root else None),
        _path_check("config", "推理配置", root / "GPT_SoVITS" / "configs" / "tts_infer.yaml" if root else None),
    ]


def check_model_instance(profile: ModelInstanceProfile) -> ModelHealthResult:
    if not profile.enabled:
        return ModelHealthResult(
            model_id=profile.model_id,
            status=ModelInstanceStatus.disabled,
            checks=[],
            repair_hint="模型已禁用。",
        )
    if profile.model_id == "indextts2":
        checks = _check_indextts2(profile)
    elif profile.model_id == "voxcpm2":
        checks = _check_voxcpm2(profile)
    elif profile.model_id == "gptsovits":
        checks = _check_gptsovits(profile)
    else:
        checks = []
        return ModelHealthResult(
            model_id=profile.model_id,
            status=ModelInstanceStatus.disabled,
            checks=checks,
            repair_hint="模型尚未接入。",
        )
    status = _status_from_checks(profile, checks)
    return ModelHealthResult(
        model_id=profile.model_id,
        status=status,
        checks=checks,
        repair_hint=_repair_hint(profile, status, checks),
    )
```

- [ ] **Step 5: Run tests for Task 2**

Run:

```powershell
.\.venv\Scripts\python.exe -m pytest tests/test_model_instances.py -q
```

Expected result: all model instance tests pass.

---

### Task 3: Model Instance Persistence and API Routes

**Files:**
- Modify: `apps/api/tts_api/model_instances.py`
- Create: `apps/api/tts_api/routes/model_instances.py`
- Modify: `apps/api/tts_api/main.py`
- Test: `apps/api/tests/test_model_instances.py`

- [ ] **Step 1: Add failing API tests**

Append these tests to `apps/api/tests/test_model_instances.py`:

```python
from fastapi.testclient import TestClient

from tts_api.config import get_settings
from tts_api.main import create_app


def make_model_instance_client(tmp_path: Path, monkeypatch):
    settings_file = tmp_path / "user-settings.json"
    monkeypatch.setenv("OPEN_TTS_SETTINGS_FILE", str(settings_file))
    monkeypatch.setenv("OPEN_TTS_INDEXTTS2_ROOT", str(tmp_path / "IndexTTS2"))
    monkeypatch.setenv("OPEN_TTS_VOXCPM2_ROOT", str(tmp_path / "VoxCPM2"))
    monkeypatch.setenv("OPEN_TTS_GPTSOVITS_ROOT", str(tmp_path / "GPT-SoVITS"))
    get_settings.cache_clear()
    return TestClient(create_app()), settings_file


def test_model_instances_endpoint_lists_profiles(tmp_path: Path, monkeypatch):
    client, _ = make_model_instance_client(tmp_path, monkeypatch)

    response = client.get("/v1/model-instances")

    assert response.status_code == 200
    body = response.json()
    assert {item["model_id"] for item in body["instances"]} == {"indextts2", "voxcpm2", "gptsovits", "f5-tts"}
    assert body["instances"][0]["status"] in {"untested", "disabled"}


def test_model_instance_patch_persists_profile(tmp_path: Path, monkeypatch):
    client, settings_file = make_model_instance_client(tmp_path, monkeypatch)
    stable_root = tmp_path / "stable-gptsovits"

    response = client.patch(
        "/v1/model-instances/gptsovits",
        json={
            "root_path": str(stable_root),
            "api_host": "127.0.0.1",
            "api_port": 9891,
            "enabled": True,
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["model_id"] == "gptsovits"
    assert body["root_path"] == str(stable_root)
    assert body["api_port"] == 9891
    assert settings_file.exists()
    assert get_settings().model_instances["gptsovits"]["root_path"] == str(stable_root)


def test_model_instance_check_updates_status(tmp_path: Path, monkeypatch):
    client, _ = make_model_instance_client(tmp_path, monkeypatch)
    root = tmp_path / "GPT-SoVITS"
    (root / "runtime").mkdir(parents=True)
    (root / "runtime" / "python.exe").write_text("python", encoding="utf-8")
    (root / "api_v2.py").write_text("api", encoding="utf-8")
    (root / "GPT_SoVITS" / "configs").mkdir(parents=True)
    (root / "GPT_SoVITS" / "configs" / "tts_infer.yaml").write_text("config", encoding="utf-8")

    response = client.post("/v1/model-instances/gptsovits/check")

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ready"
    assert body["repair_hint"] is None
```

- [ ] **Step 2: Run tests to confirm route is missing**

Run:

```powershell
.\.venv\Scripts\python.exe -m pytest tests/test_model_instances.py -q
```

Expected result: API tests fail with `404 Not Found` for `/v1/model-instances`.

- [ ] **Step 3: Add persistence helper functions**

Append to `apps/api/tts_api/model_instances.py`:

```python
from tts_api.config import get_settings, save_user_settings


def list_model_instances(settings: Settings | None = None) -> list[ModelInstanceProfile]:
    active_settings = settings or get_settings()
    return merge_model_instance_updates(
        build_default_model_instances(active_settings),
        active_settings.model_instances,
    )


def get_model_instance(model_id: str, settings: Settings | None = None) -> ModelInstanceProfile:
    for instance in list_model_instances(settings):
        if instance.model_id == model_id:
            return instance
    raise KeyError(model_id)


def persist_model_instance(instance: ModelInstanceProfile, settings: Settings | None = None) -> ModelInstanceProfile:
    active_settings = settings or get_settings()
    existing = dict(active_settings.model_instances)
    existing[instance.model_id] = instance.serializable()
    save_user_settings(active_settings.settings_file, {"model_instances": existing})
    get_settings.cache_clear()
    return get_model_instance(instance.model_id)


def update_model_instance(model_id: str, values: dict, settings: Settings | None = None) -> ModelInstanceProfile:
    current = get_model_instance(model_id, settings=settings)
    payload = {**current.serializable(), **values}
    updated = ModelInstanceProfile.model_validate(payload)
    if not updated.enabled:
        updated.status = ModelInstanceStatus.disabled
    elif updated.status == ModelInstanceStatus.disabled:
        updated.status = ModelInstanceStatus.untested
    return persist_model_instance(updated, settings=settings)
```

- [ ] **Step 4: Implement API routes**

Create `apps/api/tts_api/routes/model_instances.py`:

```python
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from tts_api.model_health import check_model_instance
from tts_api.model_instances import (
    ModelInstanceProfile,
    list_model_instances,
    get_model_instance,
    persist_model_instance,
    update_model_instance,
)

router = APIRouter()


class ModelInstanceUpdate(BaseModel):
    enabled: bool | None = None
    root_path: Path | None = None
    api_host: str | None = None
    api_port: int | None = Field(default=None, ge=1024, le=65535)


@router.get("/v1/model-instances")
def get_model_instances() -> dict:
    return {"instances": [instance.serializable() for instance in list_model_instances()]}


@router.get("/v1/model-instances/{model_id}")
def get_one_model_instance(model_id: str) -> dict:
    try:
        return get_model_instance(model_id).serializable()
    except KeyError:
        raise HTTPException(status_code=404, detail=f"Unknown model instance: {model_id}")


@router.patch("/v1/model-instances/{model_id}", response_model=ModelInstanceProfile)
def patch_model_instance(model_id: str, update: ModelInstanceUpdate) -> ModelInstanceProfile:
    try:
        return update_model_instance(model_id, update.model_dump(exclude_none=True))
    except KeyError:
        raise HTTPException(status_code=404, detail=f"Unknown model instance: {model_id}")


@router.post("/v1/model-instances/{model_id}/check")
def check_one_model_instance(model_id: str) -> dict:
    try:
        instance = get_model_instance(model_id)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"Unknown model instance: {model_id}")
    result = check_model_instance(instance)
    updated = instance.model_copy(
        update={
            "status": result.status,
            "last_health_check_at": result.checked_at,
            "last_error": result.repair_hint,
        }
    )
    persist_model_instance(updated)
    return result.model_dump(mode="json")
```

- [ ] **Step 5: Register the router**

Modify `apps/api/tts_api/main.py` import:

```python
from tts_api.routes import health, jobs, model_directories, model_instances, models, outputs, settings as settings_routes, speech, system, voices
```

Add this include near the model directories route:

```python
    app.include_router(model_instances.router)
```

- [ ] **Step 6: Run tests for Task 3**

Run:

```powershell
.\.venv\Scripts\python.exe -m pytest tests/test_model_instances.py -q
```

Expected result: all model instance route tests pass.

---

### Task 4: Resolve Generation Settings From Active Profiles

**Files:**
- Modify: `apps/api/tts_api/model_instances.py`
- Modify: `apps/api/tts_api/routes/speech.py`
- Test: `apps/api/tests/test_speech_api.py`
- Test: `apps/api/tests/test_model_instances.py`

- [ ] **Step 1: Add failing tests for applying profile settings**

Append to `apps/api/tests/test_model_instances.py`:

```python
from tts_api.model_instances import apply_model_instance_to_settings


def test_apply_gptsovits_profile_to_settings(tmp_path: Path):
    settings = Settings(gptsovits_root=tmp_path / "old", gptsovits_api_port=9880)
    profile = ModelInstanceProfile(
        model_id="gptsovits",
        display_name="GPT-SoVITS",
        runtime_type=RuntimeType.lazy_pack_api,
        root_path=tmp_path / "stable",
        api_host="127.0.0.1",
        api_port=9892,
    )

    resolved = apply_model_instance_to_settings(settings, profile)

    assert resolved.gptsovits_root == tmp_path / "stable"
    assert resolved.gptsovits_api_port == 9892


def test_apply_disabled_profile_is_rejected(tmp_path: Path):
    settings = Settings()
    profile = ModelInstanceProfile(
        model_id="indextts2",
        display_name="IndexTTS2",
        enabled=False,
        runtime_type=RuntimeType.worker_lazy_pack,
        root_path=tmp_path / "IndexTTS2",
        status=ModelInstanceStatus.disabled,
    )

    try:
        apply_model_instance_to_settings(settings, profile)
    except ValueError as exc:
        assert "disabled" in str(exc)
    else:
        raise AssertionError("Expected disabled profile to be rejected.")
```

- [ ] **Step 2: Run tests to confirm function is missing**

Run:

```powershell
.\.venv\Scripts\python.exe -m pytest tests/test_model_instances.py::test_apply_gptsovits_profile_to_settings tests/test_model_instances.py::test_apply_disabled_profile_is_rejected -q
```

Expected result: import fails because `apply_model_instance_to_settings` is not defined.

- [ ] **Step 3: Implement settings resolution**

Append to `apps/api/tts_api/model_instances.py`:

```python
def apply_model_instance_to_settings(settings: Settings, instance: ModelInstanceProfile) -> Settings:
    if not instance.enabled:
        raise ValueError(f"Model instance is disabled: {instance.model_id}")
    values = settings.model_dump()
    if instance.model_id == "indextts2" and instance.root_path is not None:
        values["indextts2_root"] = instance.root_path
    elif instance.model_id == "voxcpm2" and instance.root_path is not None:
        values["voxcpm2_root"] = instance.root_path
        if instance.api_host:
            values["voxcpm2_api_host"] = instance.api_host
        if instance.api_port:
            values["voxcpm2_api_port"] = instance.api_port
    elif instance.model_id == "gptsovits" and instance.root_path is not None:
        values["gptsovits_root"] = instance.root_path
        if instance.api_host:
            values["gptsovits_api_host"] = instance.api_host
        if instance.api_port:
            values["gptsovits_api_port"] = instance.api_port
    return Settings(**values)


def mark_model_instance_success(model_id: str, settings: Settings | None = None) -> None:
    try:
        instance = get_model_instance(model_id, settings=settings)
    except KeyError:
        return
    updated = instance.model_copy(
        update={
            "status": ModelInstanceStatus.ready,
            "last_success_at": utc_now(),
            "last_error": None,
        }
    )
    persist_model_instance(updated, settings=settings)
```

- [ ] **Step 4: Use active profile in speech route**

Modify `apps/api/tts_api/routes/speech.py`:

```python
from fastapi import HTTPException
from tts_api.model_instances import apply_model_instance_to_settings, get_model_instance, mark_model_instance_success
```

Inside `synthesize_with_registered_adapter`, after retrieving the registry model:

```python
    try:
        instance = get_model_instance(request.model, settings=settings)
        settings = apply_model_instance_to_settings(settings, instance)
    except KeyError:
        instance = None
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
```

Wrap each adapter return so success is recorded:

```python
    if model.adapter == "mock":
        result = MockTtsAdapter(settings=settings).synthesize(request)
    elif model.adapter == "voxcpm2":
        result = VoxCpm2Adapter(settings=settings).synthesize(request)
    elif model.adapter == "f5_tts":
        result = F5TtsAdapter(settings=settings).synthesize(request)
    elif model.adapter == "gptsovits":
        result = GptSoVitsAdapter(settings=settings).synthesize(request)
    elif model.adapter == "indextts2":
        result = IndexTts2Adapter(settings=settings).synthesize(request)
    else:
        raise unsupported_adapter_error(model.adapter)
    if instance is not None:
        mark_model_instance_success(request.model, settings=get_settings())
    return result
```

Remove the old direct `return` statements from the adapter branches.

- [ ] **Step 5: Run focused tests**

Run:

```powershell
.\.venv\Scripts\python.exe -m pytest tests/test_model_instances.py tests/test_speech_api.py -q
```

Expected result: tests pass.

---

### Task 5: System Status Includes Model Instance Health

**Files:**
- Modify: `apps/api/tts_api/routes/system.py`
- Test: `apps/api/tests/test_system_status.py`

- [ ] **Step 1: Add failing system status assertions**

Modify `apps/api/tests/test_system_status.py` to include:

```python
    assert "model_instances" in body
    assert "gptsovits" in body["model_instances"]
    assert "status" in body["model_instances"]["gptsovits"]
    assert "enabled" in body["model_instances"]["gptsovits"]
```

- [ ] **Step 2: Run the system status test**

Run:

```powershell
.\.venv\Scripts\python.exe -m pytest tests/test_system_status.py -q
```

Expected result: fails because `model_instances` is missing.

- [ ] **Step 3: Add profile summaries to system status**

Modify `apps/api/tts_api/routes/system.py` imports:

```python
from tts_api.model_instances import list_model_instances
```

Add this block before returning:

```python
    status["model_instances"] = {
        instance.model_id: {
            "enabled": instance.enabled,
            "status": instance.status,
            "root_path": str(instance.root_path) if instance.root_path else None,
            "last_health_check_at": instance.last_health_check_at.isoformat() if instance.last_health_check_at else None,
            "last_success_at": instance.last_success_at.isoformat() if instance.last_success_at else None,
            "last_error": instance.last_error,
        }
        for instance in list_model_instances(settings)
    }
```

- [ ] **Step 4: Run system status tests**

Run:

```powershell
.\.venv\Scripts\python.exe -m pytest tests/test_system_status.py -q
```

Expected result: tests pass.

---

### Task 6: Desktop Types and API Client

**Files:**
- Modify: `apps/desktop/src/types.ts`
- Modify: `apps/desktop/src/api.ts`

- [ ] **Step 1: Add model instance types**

Modify `apps/desktop/src/types.ts`:

```ts
export type ModelInstanceStatus = "ready" | "untested" | "missing" | "broken" | "disabled";

export type RuntimeType = "worker_lazy_pack" | "lazy_pack_api" | "reserved";

export type ModelHealthCheck = {
  id: string;
  label: string;
  passed: boolean;
  detail?: string | null;
};

export type ModelHealthResult = {
  model_id: string;
  status: ModelInstanceStatus;
  checks: ModelHealthCheck[];
  repair_hint?: string | null;
  checked_at: string;
};

export type ModelInstanceProfile = {
  model_id: string;
  display_name: string;
  enabled: boolean;
  runtime_type: RuntimeType;
  root_path?: string | null;
  api_host?: string | null;
  api_port?: number | null;
  status: ModelInstanceStatus;
  last_health_check_at?: string | null;
  last_success_at?: string | null;
  last_error?: string | null;
};

export type ModelInstancesResponse = {
  instances: ModelInstanceProfile[];
};

export type ModelInstanceUpdate = {
  enabled?: boolean;
  root_path?: string | null;
  api_host?: string | null;
  api_port?: number | null;
};
```

Add to `SystemStatus`:

```ts
  model_instances?: Record<string, Pick<ModelInstanceProfile, "enabled" | "status" | "root_path" | "last_health_check_at" | "last_success_at" | "last_error">>;
```

- [ ] **Step 2: Add API client functions**

Modify the type import in `apps/desktop/src/api.ts`:

```ts
  ModelHealthResult,
  ModelInstanceProfile,
  ModelInstancesResponse,
  ModelInstanceUpdate,
```

Add these functions:

```ts
export async function fetchModelInstances(): Promise<ModelInstanceProfile[]> {
  const response = await fetch(`${getApiBase()}/v1/model-instances`);
  if (!response.ok) {
    throw new Error(`Failed to load model instances: ${response.status}`);
  }
  const payload = (await response.json()) as ModelInstancesResponse;
  return payload.instances;
}

export async function updateModelInstance(
  modelId: string,
  update: ModelInstanceUpdate
): Promise<ModelInstanceProfile> {
  const response = await fetch(`${getApiBase()}/v1/model-instances/${modelId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(update)
  });
  if (!response.ok) {
    throw new Error(`Failed to update model instance: ${response.status}`);
  }
  return response.json();
}

export async function checkModelInstance(modelId: string): Promise<ModelHealthResult> {
  const response = await fetch(`${getApiBase()}/v1/model-instances/${modelId}/check`, {
    method: "POST"
  });
  if (!response.ok) {
    throw new Error(`Failed to check model instance: ${response.status}`);
  }
  return response.json();
}
```

- [ ] **Step 3: Run desktop build**

Run:

```powershell
npm run build
```

from `apps/desktop`.

Expected result: build passes.

---

### Task 7: Desktop Model Center UI

**Files:**
- Modify: `apps/desktop/src/App.tsx`
- Modify: `apps/desktop/src/styles.css`

- [ ] **Step 1: Import new API functions and types**

Modify `apps/desktop/src/App.tsx` imports:

```ts
  checkModelInstance,
  fetchModelInstances,
  updateModelInstance,
```

Add these imported types:

```ts
  ModelHealthResult,
  ModelInstanceProfile,
```

- [ ] **Step 2: Add state and helpers**

Add state near existing settings state:

```ts
  const [modelInstances, setModelInstances] = useState<ModelInstanceProfile[]>([]);
  const [checkingModelId, setCheckingModelId] = useState<string | null>(null);
  const [modelHealthResults, setModelHealthResults] = useState<Record<string, ModelHealthResult>>({});
```

Add helpers near `hasFeature`:

```ts
function modelInstanceStatusLabel(status: string | undefined) {
  if (status === "ready") {
    return "可用";
  }
  if (status === "untested") {
    return "未测试";
  }
  if (status === "missing") {
    return "缺失";
  }
  if (status === "broken") {
    return "需修复";
  }
  if (status === "disabled") {
    return "已禁用";
  }
  return "未知";
}

function runtimeTypeLabel(runtimeType: string) {
  if (runtimeType === "worker_lazy_pack") {
    return "懒人包 Worker";
  }
  if (runtimeType === "lazy_pack_api") {
    return "本地 API";
  }
  return "预留";
}

function isModelInstanceUsable(instance: ModelInstanceProfile | undefined) {
  return Boolean(instance?.enabled) && instance?.status !== "missing" && instance?.status !== "broken" && instance?.status !== "disabled";
}
```

Add memoized selected instance:

```ts
  const selectedModelInstance = useMemo(
    () => modelInstances.find((instance) => instance.model_id === selectedModel),
    [modelInstances, selectedModel]
  );
```

Update `canGenerate`:

```ts
    isModelInstanceUsable(selectedModelInstance) &&
```

Insert that condition after `!loading &&`.

- [ ] **Step 3: Load model instances**

Add function near `loadModelDirectories`:

```ts
  async function loadModelInstances() {
    try {
      const instances = await fetchModelInstances();
      setModelInstances(instances);
    } catch {
      setModelInstances([]);
    }
  }
```

Call it in the initial `useEffect`:

```ts
    loadModelInstances();
```

Call it inside `openSettings`:

```ts
    void loadModelInstances();
```

Call it after successful generation in `onGenerate`:

```ts
      void loadModelInstances();
```

- [ ] **Step 4: Add model instance actions**

Add functions near `chooseDirectoryForSetting`:

```ts
  async function chooseModelInstanceDirectory(instance: ModelInstanceProfile) {
    if (!window.desktopFiles?.selectDirectory) {
      setSettingsError("当前预览环境不支持选择目录");
      return;
    }
    setSettingsError(null);
    try {
      const directoryPath = await window.desktopFiles.selectDirectory();
      if (!directoryPath) {
        return;
      }
      const updated = await updateModelInstance(instance.model_id, { root_path: directoryPath });
      setModelInstances((items) => items.map((item) => (item.model_id === updated.model_id ? updated : item)));
    } catch (err) {
      setSettingsError(err instanceof Error ? err.message : "选择目录失败");
    }
  }

  async function onCheckModelInstance(instance: ModelInstanceProfile) {
    setCheckingModelId(instance.model_id);
    setSettingsError(null);
    try {
      const result = await checkModelInstance(instance.model_id);
      setModelHealthResults((results) => ({ ...results, [instance.model_id]: result }));
      await loadModelInstances();
    } catch (err) {
      setSettingsError(err instanceof Error ? err.message : "检查模型失败");
    } finally {
      setCheckingModelId(null);
    }
  }

  async function onToggleModelInstance(instance: ModelInstanceProfile) {
    setSettingsError(null);
    try {
      const updated = await updateModelInstance(instance.model_id, { enabled: !instance.enabled });
      setModelInstances((items) => items.map((item) => (item.model_id === updated.model_id ? updated : item)));
    } catch (err) {
      setSettingsError(err instanceof Error ? err.message : "切换模型状态失败");
    }
  }
```

- [ ] **Step 5: Replace the settings local model fields with Model Center**

In `apps/desktop/src/App.tsx`, replace the first settings group body under `<span>本地模型</span>` with:

```tsx
                <div className="modelCenterList">
                  {modelInstances.map((instance) => {
                    const healthResult = modelHealthResults[instance.model_id];
                    return (
                      <div key={instance.model_id} className="modelCenterCard">
                        <div className="modelCenterHeader">
                          <div>
                            <strong>{instance.display_name}</strong>
                            <span>{runtimeTypeLabel(instance.runtime_type)}</span>
                          </div>
                          <span className={`modelState ${instance.status}`}>{modelInstanceStatusLabel(instance.status)}</span>
                        </div>
                        <div className="modelCenterPath">
                          <span>{instance.root_path ?? "未配置目录"}</span>
                        </div>
                        <div className="modelCenterMeta">
                          <span>{instance.enabled ? "已启用" : "已禁用"}</span>
                          <span>{instance.last_success_at ? `成功：${new Date(instance.last_success_at).toLocaleString()}` : "尚无成功记录"}</span>
                        </div>
                        {(healthResult?.repair_hint || instance.last_error) && (
                          <div className="modelRepairHint">{healthResult?.repair_hint ?? instance.last_error}</div>
                        )}
                        {healthResult && healthResult.checks.length > 0 && (
                          <div className="modelCheckList">
                            {healthResult.checks.map((check) => (
                              <span key={check.id} className={check.passed ? "checkItem passed" : "checkItem failed"}>
                                {check.label}
                              </span>
                            ))}
                          </div>
                        )}
                        <div className="modelCenterActions">
                          <button className="pathPickButton" onClick={() => void onCheckModelInstance(instance)} disabled={checkingModelId === instance.model_id}>
                            {checkingModelId === instance.model_id ? <Loader2 className="spin" size={15} /> : <CheckCircle2 size={15} strokeWidth={1.9} />}
                            <span>检查</span>
                          </button>
                          <button className="pathPickButton" onClick={() => void chooseModelInstanceDirectory(instance)}>
                            <FolderOpen size={15} strokeWidth={1.9} />
                            <span>选择目录</span>
                          </button>
                          <button className="pathPickButton" onClick={() => void openModelDirectory({ id: instance.model_id, display_name: instance.display_name, path: instance.root_path ?? "", exists: Boolean(instance.root_path), kind: "model_root" })} disabled={!instance.root_path}>
                            <FolderOpen size={15} strokeWidth={1.9} />
                            <span>打开</span>
                          </button>
                          <button className="pathPickButton" onClick={() => void onToggleModelInstance(instance)}>
                            <ShieldCheck size={15} strokeWidth={1.9} />
                            <span>{instance.enabled ? "禁用" : "启用"}</span>
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
```

Keep the `空闲释放显存` field below the Model Center list because it is a global IndexTTS2 runtime policy:

```tsx
                <label className="settingsField">
                  <span>IndexTTS2 空闲释放显存</span>
                  <input
                    type="number"
                    min={30}
                    max={86400}
                    step={30}
                    value={settingsDraft.indextts2_idle_timeout_seconds}
                    onChange={(event) =>
                      setSettingsDraft((draft) => ({
                        ...draft,
                        indextts2_idle_timeout_seconds: Number(event.target.value)
                      }))
                    }
                  />
                </label>
```

- [ ] **Step 6: Add readiness hint near generate button**

Above the `.leftActions` block in `apps/desktop/src/App.tsx`, add:

```tsx
            {!isModelInstanceUsable(selectedModelInstance) && (
              <div className="capabilityNote compactCapabilityNote">
                <AlertCircle size={17} strokeWidth={1.9} />
                <span>当前模型还没有通过稳定检查，请在设置里的模型管理中心检查或修复。</span>
              </div>
            )}
```

- [ ] **Step 7: Add Model Center styles**

Append to `apps/desktop/src/styles.css` before `.settingsFeedback`:

```css
.modelCenterList {
  min-width: 0;
  display: grid;
  gap: 12px;
}

.modelCenterCard {
  min-width: 0;
  border-radius: 8px;
  padding: 12px;
  background: rgba(224, 233, 241, 0.54);
  box-shadow: var(--inner);
  display: grid;
  gap: 10px;
}

.modelCenterHeader,
.modelCenterMeta,
.modelCenterActions,
.modelCheckList {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
}

.modelCenterHeader {
  justify-content: space-between;
}

.modelCenterHeader strong,
.modelCenterHeader span,
.modelCenterPath span,
.modelCenterMeta span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.modelCenterHeader strong {
  display: block;
  color: #33475a;
  font-size: 14px;
}

.modelCenterHeader div span,
.modelCenterMeta span {
  color: #718093;
  font-size: 12px;
}

.modelState,
.checkItem {
  flex: 0 0 auto;
  min-height: 26px;
  border-radius: 8px;
  padding: 5px 9px;
  color: #718093;
  background: rgba(232, 239, 245, 0.74);
  box-shadow: var(--inner);
  font-size: 12px;
  font-weight: 760;
}

.modelState.ready,
.checkItem.passed {
  color: #2f7a51;
  background: rgba(230, 247, 237, 0.86);
}

.modelState.missing,
.modelState.broken,
.checkItem.failed {
  color: #9d6240;
  background: rgba(255, 242, 230, 0.86);
}

.modelState.disabled {
  color: #8b98a6;
  background: rgba(224, 233, 241, 0.72);
}

.modelCenterPath {
  min-width: 0;
  border-radius: 8px;
  padding: 9px 10px;
  background: rgba(248, 251, 253, 0.58);
  box-shadow: var(--inner);
}

.modelCenterPath span {
  display: block;
  color: #4d6072;
  font-family: "JetBrains Mono", Consolas, monospace;
  font-size: 11px;
}

.modelRepairHint {
  min-width: 0;
  border-radius: 8px;
  padding: 9px 10px;
  color: #8a5a38;
  background: rgba(255, 246, 232, 0.78);
  box-shadow: var(--inner);
  font-size: 12px;
  line-height: 1.45;
}

.modelCenterActions,
.modelCheckList {
  flex-wrap: wrap;
}
```

- [ ] **Step 8: Run desktop build**

Run:

```powershell
npm run build
```

from `apps/desktop`.

Expected result: build passes.

---

### Task 8: Verification and Preview Restart

**Files:**
- No new source files.

- [ ] **Step 1: Run backend full test suite**

Run:

```powershell
.\.venv\Scripts\python.exe -m pytest -q
```

from `apps/api`.

Expected result: all tests pass.

- [ ] **Step 2: Run desktop build**

Run:

```powershell
npm run build
```

from `apps/desktop`.

Expected result: Vite build succeeds.

- [ ] **Step 3: Run Electron tests**

Run:

```powershell
npm run test:electron
```

from `apps/desktop`.

Expected result: all Electron tests pass.

- [ ] **Step 4: Restart local API**

Run from `D:\code\tts`:

```powershell
$targets = Get-CimInstance Win32_Process | Where-Object { $_.Name -like 'python*' -and $_.CommandLine -like '*uvicorn*tts_api.main:app*8765*' }
foreach ($target in $targets) { Stop-Process -Id $target.ProcessId -Force }
$process = Start-Process -FilePath 'D:\code\tts\apps\api\.venv\Scripts\python.exe' -ArgumentList @('-m','uvicorn','tts_api.main:app','--host','127.0.0.1','--port','8765') -WorkingDirectory 'D:\code\tts\apps\api' -WindowStyle Hidden -PassThru
$process.Id
```

Expected result: a new process id is printed.

- [ ] **Step 5: Verify backend endpoints**

Run:

```powershell
Invoke-RestMethod -Uri http://127.0.0.1:8765/v1/model-instances | ConvertTo-Json -Depth 6
Invoke-RestMethod -Uri http://127.0.0.1:8765/v1/system/status | ConvertTo-Json -Depth 6
```

Expected result: `model-instances` returns IndexTTS2, VoxCPM2, GPT-SoVITS, and F5-TTS; system status includes `model_instances`.

- [ ] **Step 6: Restart desktop preview**

Run from `D:\code\tts`:

```powershell
$targets = Get-CimInstance Win32_Process | Where-Object { $_.Name -like 'electron*' -and $_.CommandLine -like '*D:\code\tts\apps\desktop*electron/main.cjs*' }
foreach ($target in $targets) { Stop-Process -Id $target.ProcessId -Force }
$env:OPEN_TTS_DESKTOP_FORCE_DIST='1'
$process = Start-Process -FilePath 'D:\code\tts\apps\desktop\node_modules\electron\dist\electron.exe' -ArgumentList 'electron/main.cjs' -WorkingDirectory 'D:\code\tts\apps\desktop' -PassThru
$process.Id
```

Expected result: OpenTTS Studio launches with the new Model Center in settings.

- [ ] **Step 7: Visual smoke check**

Use the desktop window to verify:

- Settings opens.
- Model Center shows IndexTTS2, VoxCPM2, GPT-SoVITS, and F5-TTS.
- `检查` updates a model card.
- Broken or missing models show repair hints.
- Generation screen disables the start button when the selected model is disabled, missing, or broken.

---

## Self-Review

Spec coverage:

- Stable one-instance-per-model management is implemented by Tasks 1 and 3.
- Health checks without GPU loading are implemented by Task 2.
- Generation uses active stable profiles in Task 4.
- System status includes model health in Task 5.
- Desktop Model Center replaces raw path management in Task 7.
- Automatic downloads, automatic upgrades, and multiple active versions are not included.

Placeholder scan:

- The plan contains no placeholder markers, no unfinished requirements, and no unnamed files.

Type consistency:

- Backend uses `ModelInstanceProfile`, `ModelInstanceStatus`, `RuntimeType`, `ModelHealthCheck`, and `ModelHealthResult`.
- Desktop mirrors those names as `ModelInstanceProfile`, `ModelInstanceStatus`, `RuntimeType`, `ModelHealthCheck`, and `ModelHealthResult`.
- API endpoint paths are consistently `/v1/model-instances`.

Repository note:

- This workspace currently is not a Git repository, so commit steps are intentionally omitted. If this project is later placed under Git, commit after each completed task with a focused message such as `feat: add model instance profiles`.
