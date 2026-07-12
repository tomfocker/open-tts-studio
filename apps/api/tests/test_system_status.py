from fastapi.testclient import TestClient

from tts_api.config import get_settings
from tts_api.main import app, create_app


def test_system_status_returns_resource_and_worker_state():
    client = TestClient(app)

    response = client.get("/v1/system/status")

    assert response.status_code == 200
    body = response.json()
    assert body["api"]["status"] == "ok"
    assert "uptime_seconds" in body["api"]
    assert "cpu_percent" in body["system"]
    assert "memory_percent" in body["system"]
    assert "gpu" in body
    assert "indextts2" in body["workers"]
    assert "loaded" in body["workers"]["indextts2"]
    assert "idle_timeout_seconds" in body["workers"]["indextts2"]
    assert "gptsovits" in body["workers"]
    assert "loaded" in body["workers"]["gptsovits"]
    assert "api_base" in body["workers"]["gptsovits"]
    assert "model_instances" in body
    assert "gptsovits" in body["model_instances"]
    assert "status" in body["model_instances"]["gptsovits"]
    assert "enabled" in body["model_instances"]["gptsovits"]


def test_system_status_worker_roots_use_active_model_instance_paths(tmp_path, monkeypatch):
    settings_file = tmp_path / "settings.json"
    old_gptsovits_root = tmp_path / "old-gptsovits"
    stable_gptsovits_root = tmp_path / "stable-gptsovits"
    old_gptsovits_root.mkdir()
    stable_gptsovits_root.mkdir()
    monkeypatch.setenv("OPEN_TTS_SETTINGS_FILE", str(settings_file))
    monkeypatch.setenv("OPEN_TTS_GPTSOVITS_ROOT", str(old_gptsovits_root))
    get_settings.cache_clear()
    client = TestClient(create_app())
    update_response = client.patch(
        "/v1/model-instances/gptsovits",
        json={"root_path": str(stable_gptsovits_root), "api_port": 9897},
    )
    assert update_response.status_code == 200

    response = client.get("/v1/system/status")

    assert response.status_code == 200
    body = response.json()
    assert body["workers"]["gptsovits"]["root"] == str(stable_gptsovits_root)
    assert body["workers"]["gptsovits"]["api_base"] == "http://127.0.0.1:9897"
