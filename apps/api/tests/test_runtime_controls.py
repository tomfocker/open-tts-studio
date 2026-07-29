from fastapi.testclient import TestClient
import pytest

from tts_api.config import get_settings
from tts_api.main import create_app
from tts_api.routes import runtime


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
