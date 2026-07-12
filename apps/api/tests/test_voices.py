from fastapi.testclient import TestClient

from tts_api.config import get_settings
from tts_api.main import app


def test_list_voices_returns_builtin_default():
    client = TestClient(app)
    response = client.get("/v1/tts/voices")

    assert response.status_code == 200
    voices = response.json()
    assert voices[0]["id"] == "default"
    assert voices[0]["authorization_status"] == "built_in"


def test_create_voice_preset_records_authorization(tmp_path, monkeypatch):
    monkeypatch.setenv("OPEN_TTS_VOICE_LIBRARY_FILE", str(tmp_path / "voices.json"))
    get_settings.cache_clear()
    client = TestClient(app)
    response = client.post(
        "/v1/tts/voices",
        json={
            "name": "Test Voice",
            "reference_audio": "D:/voices/test.wav",
            "reference_text": "This is a test.",
            "authorization_status": "authorized",
        },
    )

    assert response.status_code == 200
    assert response.json()["name"] == "Test Voice"
    assert response.json()["authorization_status"] == "authorized"


def test_create_voice_preset_persists_to_voice_library_file(tmp_path, monkeypatch):
    voice_library_file = tmp_path / "voices.json"
    monkeypatch.setenv("OPEN_TTS_VOICE_LIBRARY_FILE", str(voice_library_file))
    get_settings.cache_clear()
    client = TestClient(app)

    response = client.post(
        "/v1/tts/voices",
        json={
            "name": "Warm Demo",
            "reference_audio": "D:/voices/warm-demo.wav",
            "reference_text": "This is the reference text.",
            "authorization_status": "authorized",
        },
    )

    assert response.status_code == 200
    created_voice = response.json()
    assert voice_library_file.exists()

    get_settings.cache_clear()
    reload_response = client.get("/v1/tts/voices")

    assert reload_response.status_code == 200
    assert any(voice["id"] == created_voice["id"] for voice in reload_response.json())


def test_delete_voice_preset_removes_it_from_library_file(tmp_path, monkeypatch):
    voice_library_file = tmp_path / "voices.json"
    monkeypatch.setenv("OPEN_TTS_VOICE_LIBRARY_FILE", str(voice_library_file))
    get_settings.cache_clear()
    client = TestClient(app)
    create_response = client.post(
        "/v1/tts/voices",
        json={
            "name": "Disposable Demo",
            "reference_audio": "D:/voices/disposable.wav",
            "authorization_status": "authorized",
        },
    )
    voice_id = create_response.json()["id"]

    delete_response = client.delete(f"/v1/tts/voices/{voice_id}")
    list_response = client.get("/v1/tts/voices")

    assert delete_response.status_code == 204
    assert all(voice["id"] != voice_id for voice in list_response.json())
