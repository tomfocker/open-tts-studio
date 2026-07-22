import json
from pathlib import Path
from zipfile import ZipFile

from fastapi.testclient import TestClient

from tts_api.audio import write_sine_wav
from tts_api.config import get_settings
from tts_api.main import app


def test_list_voices_returns_builtin_default():
    client = TestClient(app)
    response = client.get("/v1/tts/voices")

    assert response.status_code == 200
    voices = response.json()
    assert voices[0]["id"] == "default"
    assert voices[0]["authorization_status"] == "built_in"


def test_create_voice_copies_reference_audio_into_managed_library(tmp_path: Path, monkeypatch):
    voice_library_file = tmp_path / "voices.json"
    source_audio = tmp_path / "source.wav"
    write_sine_wav(source_audio, duration_seconds=5)
    monkeypatch.setenv("OPEN_TTS_VOICE_LIBRARY_FILE", str(voice_library_file))
    get_settings.cache_clear()
    client = TestClient(app)

    response = client.post(
        "/v1/tts/voices",
        json={
            "name": "Narrator",
            "reference_audio": str(source_audio),
            "reference_text": "第一条参考文本。",
            "authorization_status": "authorized",
        },
    )

    assert response.status_code == 200
    voice = response.json()
    assert voice["reference_audio_managed"] is True
    assert voice["original_reference_audio"] == str(source_audio)
    assert voice["reference_audio_sha256"]
    assert Path(voice["reference_audio"]).is_file()
    assert Path(voice["reference_audio"]) != source_audio


def test_update_voice_replaces_audio_and_reference_text(tmp_path: Path, monkeypatch):
    voice_library_file = tmp_path / "voices.json"
    source_audio = tmp_path / "source.wav"
    replacement_audio = tmp_path / "replacement.wav"
    write_sine_wav(source_audio, duration_seconds=5)
    write_sine_wav(replacement_audio, duration_seconds=6)
    monkeypatch.setenv("OPEN_TTS_VOICE_LIBRARY_FILE", str(voice_library_file))
    get_settings.cache_clear()
    client = TestClient(app)

    created = client.post(
        "/v1/tts/voices",
        json={"name": "Narrator", "reference_audio": str(source_audio), "authorization_status": "authorized"},
    ).json()
    response = client.patch(
        f"/v1/tts/voices/{created['id']}",
        json={"reference_audio": str(replacement_audio), "reference_text": "替换后的参考文本。"},
    )

    assert response.status_code == 200
    updated = response.json()
    assert updated["original_reference_audio"] == str(replacement_audio)
    assert updated["reference_text"] == "替换后的参考文本。"
    assert updated["reference_audio_managed"] is True
    assert Path(updated["reference_audio"]).is_file()


def test_voice_package_exports_and_imports_portably(tmp_path: Path, monkeypatch):
    voice_library_file = tmp_path / "voices.json"
    source_audio = tmp_path / "source.wav"
    write_sine_wav(source_audio, duration_seconds=5)
    monkeypatch.setenv("OPEN_TTS_VOICE_LIBRARY_FILE", str(voice_library_file))
    get_settings.cache_clear()
    client = TestClient(app)
    created = client.post(
        "/v1/tts/voices",
        json={
            "name": "Portable Narrator",
            "reference_audio": str(source_audio),
            "reference_text": "这是一条可以带走的参考文本。",
            "authorization_status": "authorized",
            "source_type": "local_import",
        },
    ).json()

    export_response = client.post(f"/v1/tts/voices/{created['id']}/export")

    assert export_response.status_code == 200
    package_path = Path(export_response.json()["export_path"])
    assert package_path.is_file()
    with ZipFile(package_path) as package:
        assert set(package.namelist()) == {"voice.json", "audio/reference.wav"}
        manifest = json.loads(package.read("voice.json"))
        assert manifest["voice"]["reference_audio"] == "audio/reference.wav"
        assert str(source_audio) not in package.read("voice.json").decode("utf-8")

    import_response = client.post("/v1/tts/voices/import", json={"package_path": str(package_path)})

    assert import_response.status_code == 200
    imported = import_response.json()
    assert imported["id"] != created["id"]
    assert imported["name"] == "Portable Narrator"
    assert imported["reference_text"] == "这是一条可以带走的参考文本。"
    assert imported["reference_audio_managed"] is True
    assert Path(imported["reference_audio"]).is_file()


def test_voice_package_rejects_unsafe_audio_path(tmp_path: Path, monkeypatch):
    package_path = tmp_path / "unsafe.zip"
    with ZipFile(package_path, "w") as package:
        package.writestr(
            "voice.json",
            '{"schema":"open-tts-voice-package","version":1,"voice":{"name":"Unsafe","reference_audio":"../outside.wav"}}',
        )
        package.writestr("../outside.wav", b"not-audio")
    monkeypatch.setenv("OPEN_TTS_VOICE_LIBRARY_FILE", str(tmp_path / "voices.json"))
    get_settings.cache_clear()
    client = TestClient(app)

    response = client.post("/v1/tts/voices/import", json={"package_path": str(package_path)})

    assert response.status_code == 422


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
