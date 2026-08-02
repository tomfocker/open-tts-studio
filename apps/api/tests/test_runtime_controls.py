from fastapi.testclient import TestClient
import pytest

from tts_api.config import get_settings
from tts_api.main import create_app
from tts_api.routes import realtime, runtime


def test_runtime_stop_is_safe_when_no_managed_process_exists(tmp_path, monkeypatch):
    monkeypatch.setenv("OPEN_TTS_SETTINGS_FILE", str(tmp_path / "settings.json"))
    monkeypatch.setenv("OPEN_TTS_VOXCPM2_ROOT", str(tmp_path / "VoxCPM2"))
    get_settings.cache_clear()
    client = TestClient(create_app())

    response = client.post("/v1/runtime/models/voxcpm2/stop")

    assert response.status_code == 200
    body = response.json()
    assert body["released"] is False
    assert body["worker"]["managed"] is False


def test_runtime_start_rejects_an_incomplete_model_package(tmp_path, monkeypatch):
    monkeypatch.setenv("OPEN_TTS_SETTINGS_FILE", str(tmp_path / "settings.json"))
    monkeypatch.setenv("OPEN_TTS_GPTSOVITS_ROOT", str(tmp_path / "incomplete"))
    get_settings.cache_clear()
    client = TestClient(create_app())

    response = client.post("/v1/runtime/models/gptsovits/start")

    assert response.status_code == 409
    assert "模型目录" in response.json()["detail"] or "GPT-SoVITS" in response.json()["detail"]


@pytest.mark.parametrize(
    ("model_id", "manager_getter"),
    [
        ("voxcpm2", "get_voxcpm2_service_manager"),
        ("gptsovits", "get_gptsovits_service_manager"),
    ],
)
def test_runtime_start_waits_until_local_api_model_is_ready(monkeypatch, model_id, manager_getter):
    calls = []

    class FakeManager:
        def ensure_started(self):
            calls.append("ensure_started")

    monkeypatch.setattr(runtime, "_assert_startable", lambda _model_id: get_settings())
    monkeypatch.setattr(runtime, "release_conflicting_runtimes", lambda _model_id, _settings: [])
    monkeypatch.setattr(runtime, manager_getter, lambda _settings: FakeManager())
    monkeypatch.setattr(runtime, "_worker_status", lambda _model_id, _settings: {"loaded": True})

    result = runtime.start_model_runtime(model_id)

    assert calls == ["ensure_started"]
    assert result["worker"]["loaded"] is True


def test_runtime_start_holds_the_shared_gpu_lock_during_warmup(monkeypatch):
    calls: list[str] = []

    class RecordingLock:
        def __enter__(self):
            calls.append("lock.acquire")
            return self

        def __exit__(self, *_args):
            calls.append("lock.release")

    class FakeManager:
        def ensure_started(self):
            calls.append("ensure_started")

    monkeypatch.setattr(runtime, "_assert_startable", lambda _model_id: get_settings())
    monkeypatch.setattr(runtime, "local_gpu_generation_lock", RecordingLock())
    monkeypatch.setattr(runtime, "release_conflicting_runtimes", lambda _model_id, _settings: calls.append("release_conflicts") or [])
    monkeypatch.setattr(runtime, "get_voxcpm2_service_manager", lambda _settings: FakeManager())
    monkeypatch.setattr(runtime, "_worker_status", lambda _model_id, _settings: {"loaded": True})

    result = runtime.start_model_runtime("voxcpm2")

    assert result["worker"]["loaded"] is True
    assert calls == ["lock.acquire", "release_conflicts", "ensure_started", "lock.release"]


@pytest.mark.parametrize("model_id", ["voxcpm2", "indextts2", "gptsovits", "sensevoice"])
def test_runtime_start_rejects_all_local_warmups_while_realtime_has_reserved_gpu(monkeypatch, model_id):
    monkeypatch.setattr(runtime, "_assert_startable", lambda _model_id: get_settings())
    monkeypatch.setattr(runtime, "is_realtime_runtime_reserved", lambda: True)

    client = TestClient(create_app())
    response = client.post(f"/v1/runtime/models/{model_id}/start")

    assert response.status_code == 409
    assert "实时语音模式正在独占 GPU" in response.json()["detail"]


def test_realtime_runtime_reserve_and_release_endpoints(monkeypatch):
    released: list[str] = []
    release_calls: list[bool] = []
    monkeypatch.setattr(realtime, "reserve_realtime_runtime", lambda _settings: released.append("voxcpm2") or ["voxcpm2"])
    monkeypatch.setattr(realtime, "release_realtime_runtime_reservation", lambda: release_calls.append(True))
    monkeypatch.setattr(realtime, "release_whispera_streaming_service", lambda _settings: True)
    monkeypatch.setattr(realtime, "release_realtime_asr", lambda: True)

    client = TestClient(create_app())
    reserve_response = client.post("/v1/realtime/runtime/reserve")
    release_response = client.post("/v1/realtime/runtime/release")

    assert reserve_response.status_code == 200
    assert reserve_response.json() == {"reserved": True, "released_models": ["voxcpm2"]}
    assert release_response.status_code == 200
    assert release_response.json() == {"reserved": False, "released_worker": True, "released_asr": True}
    assert released == ["voxcpm2"]
    assert release_calls == [True]


def test_realtime_runtime_prewarm_requires_a_reservation(monkeypatch):
    monkeypatch.setattr(realtime, "is_realtime_runtime_reserved", lambda: False)

    client = TestClient(create_app())
    response = client.post("/v1/realtime/runtime/prewarm")

    assert response.status_code == 409
    assert "预约" in response.json()["detail"]


def test_realtime_runtime_prewarm_loads_the_reserved_whispera_worker(monkeypatch):
    calls: list[str] = []

    class FakeManager:
        def prewarm_model(self):
            calls.append("prewarm_model")
            return {"compile_enabled": True, "compile_warmed": True, "compile_seconds": 12.5}

        def shutdown(self, force=False):
            calls.append(f"shutdown:{force}")

        def status(self):
            return {"loaded": True, "state": "loaded"}

    class RecordingLock:
        def __enter__(self):
            calls.append("lock.acquire")
            return self

        def __exit__(self, *_args):
            calls.append("lock.release")

    monkeypatch.setattr(realtime, "is_realtime_runtime_reserved", lambda: True)
    monkeypatch.setattr(realtime, "local_gpu_generation_lock", RecordingLock())
    monkeypatch.setattr(realtime, "release_conflicting_runtimes", lambda _model, _settings: calls.append("release_conflicts") or [])
    monkeypatch.setattr(realtime, "get_whispera_streaming_service_manager", lambda _settings: FakeManager())
    monkeypatch.setattr(
        realtime,
        "prewarm_realtime_asr",
        lambda _settings: calls.append("prewarm_asr") or {
            "ready": True,
            "device": "cuda",
            "cpu_fallback": False,
            "worker": {"loaded": True, "state": "loaded", "managed": True},
        },
    )

    client = TestClient(create_app())
    response = client.post("/v1/realtime/runtime/prewarm")

    assert response.status_code == 200
    assert response.json() == {
        "ready": True,
        "worker": {"loaded": True, "state": "loaded"},
        "compile_enabled": True,
        "compile_warmed": True,
        "compile_seconds": 12.5,
        "asr": {
            "ready": True,
            "device": "cuda",
            "cpu_fallback": False,
            "worker": {"loaded": True, "state": "loaded", "managed": True},
        },
    }
    assert calls == ["lock.acquire", "release_conflicts", "prewarm_model", "prewarm_asr", "lock.release"]
