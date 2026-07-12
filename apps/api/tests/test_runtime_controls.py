from fastapi.testclient import TestClient

from tts_api.config import get_settings
from tts_api.main import create_app


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
