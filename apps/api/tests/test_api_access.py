from fastapi.testclient import TestClient

from tts_api.config import get_settings
from tts_api.main import create_app


def test_api_key_is_opt_in_and_protects_v1_routes(tmp_path, monkeypatch):
    monkeypatch.setenv("OPEN_TTS_SETTINGS_FILE", str(tmp_path / "settings.json"))
    monkeypatch.setenv("OPEN_TTS_API_KEY", "local-test-key")
    get_settings.cache_clear()
    client = TestClient(create_app())

    assert client.get("/v1/health").status_code == 200
    assert client.get("/v1/tts/models").status_code == 401
    assert client.get("/v1/tts/models", headers={"X-OpenTTS-Key": "local-test-key"}).status_code == 200
    assert client.get("/v1/tts/models", headers={"Authorization": "Bearer local-test-key"}).status_code == 200


def test_settings_never_returns_the_api_access_key(tmp_path, monkeypatch):
    monkeypatch.setenv("OPEN_TTS_SETTINGS_FILE", str(tmp_path / "settings.json"))
    monkeypatch.setenv("OPEN_TTS_API_KEY", "local-test-key")
    get_settings.cache_clear()
    client = TestClient(create_app())

    settings = client.get("/v1/settings", headers={"X-OpenTTS-Key": "local-test-key"}).json()

    assert settings["api_access_key_required"] is True
    assert "api_access_key" not in settings
