import json
import struct
import wave
from pathlib import Path
from zipfile import ZipFile

from fastapi.testclient import TestClient

from tts_api.audio import write_sine_wav
from tts_api.config import get_settings
from tts_api.main import app
from tts_api.routes import voices as voice_routes
from tts_api import voice_library


def write_float_wav(path: Path, sample_rate: int = 48000, duration_seconds: float = 1.0) -> None:
    """Write a minimal IEEE-float WAV that Python 3.11's wave module rejects."""
    frame_count = int(sample_rate * duration_seconds)
    samples = b"".join(struct.pack("<f", 0.2) for _ in range(frame_count))
    fmt_chunk = struct.pack("<HHIIHH", 3, 1, sample_rate, sample_rate * 4, 4, 32)
    payload = b"WAVE" + b"fmt " + struct.pack("<I", len(fmt_chunk)) + fmt_chunk + b"data" + struct.pack("<I", len(samples)) + samples
    path.write_bytes(b"RIFF" + struct.pack("<I", len(payload)) + payload)


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


def test_role_references_switch_active_clip_and_delete_nonfinal_clip(tmp_path: Path, monkeypatch):
    voice_library_file = tmp_path / "voices.json"
    main_audio = tmp_path / "main.wav"
    alternate_audio = tmp_path / "alternate.wav"
    write_sine_wav(main_audio, duration_seconds=5)
    write_sine_wav(alternate_audio, duration_seconds=6)
    monkeypatch.setenv("OPEN_TTS_VOICE_LIBRARY_FILE", str(voice_library_file))
    get_settings.cache_clear()
    client = TestClient(app)

    created = client.post(
        "/v1/tts/voices",
        json={
            "name": "Narrator",
            "reference_audio": str(main_audio),
            "reference_text": "第一条参考。",
            "authorization_status": "authorized",
        },
    ).json()
    first_reference = created["references"][0]
    first_managed_path = Path(first_reference["reference_audio"])
    appended_response = client.post(
        f"/v1/tts/voices/{created['id']}/references",
        json={
            "name": "高情绪片段",
            "reference_audio": str(alternate_audio),
            "reference_text": "第二条参考。",
        },
    )

    assert appended_response.status_code == 200
    appended = appended_response.json()
    assert len(appended["references"]) == 2
    alternate_reference = next(item for item in appended["references"] if item["id"] != first_reference["id"])

    activated_response = client.post(
        f"/v1/tts/voices/{created['id']}/references/{alternate_reference['id']}/activate"
    )

    assert activated_response.status_code == 200
    activated = activated_response.json()
    assert activated["active_reference_id"] == alternate_reference["id"]
    assert activated["reference_audio"] == alternate_reference["reference_audio"]
    assert activated["reference_text"] == "第二条参考。"

    deleted_response = client.delete(
        f"/v1/tts/voices/{created['id']}/references/{first_reference['id']}"
    )

    assert deleted_response.status_code == 200
    remaining = deleted_response.json()
    assert [item["id"] for item in remaining["references"]] == [alternate_reference["id"]]
    assert remaining["reference_audio"] == alternate_reference["reference_audio"]
    assert not first_managed_path.exists()


def test_legacy_voice_library_migrates_root_reference_to_main_clip(tmp_path: Path, monkeypatch):
    voice_library_file = tmp_path / "voices.json"
    source_audio = tmp_path / "legacy.wav"
    write_sine_wav(source_audio, duration_seconds=5)
    voice_library_file.write_text(
        json.dumps(
            {
                "voices": [
                    {
                        "id": "legacy-narrator",
                        "name": "Legacy Narrator",
                        "reference_audio": str(source_audio),
                        "reference_text": "旧格式的参考文本。",
                        "authorization_status": "authorized",
                        "source_type": "local_import",
                    }
                ]
            }
        ),
        encoding="utf-8",
    )
    monkeypatch.setenv("OPEN_TTS_VOICE_LIBRARY_FILE", str(voice_library_file))
    get_settings.cache_clear()
    client = TestClient(app)

    response = client.get("/v1/tts/voices")

    assert response.status_code == 200
    migrated = next(item for item in response.json() if item["id"] == "legacy-narrator")
    assert migrated["active_reference_id"] == "legacy-main"
    assert migrated["references"][0]["name"] == "主参考"
    assert migrated["references"][0]["reference_audio"] == str(source_audio)
    stored = json.loads(voice_library_file.read_text(encoding="utf-8"))
    assert stored["voices"][0]["references"][0]["id"] == "legacy-main"


def test_create_voice_trims_reference_audio_before_storing(tmp_path: Path, monkeypatch):
    voice_library_file = tmp_path / "voices.json"
    source_audio = tmp_path / "source.wav"
    write_sine_wav(source_audio, duration_seconds=10)
    monkeypatch.setenv("OPEN_TTS_VOICE_LIBRARY_FILE", str(voice_library_file))
    get_settings.cache_clear()
    commands: list[list[str]] = []

    def fake_ffmpeg(command, **_kwargs):
        commands.append(command)
        write_sine_wav(Path(command[-1]), duration_seconds=4)

    monkeypatch.setattr(voice_library.subprocess, "run", fake_ffmpeg)
    client = TestClient(app)

    response = client.post(
        "/v1/tts/voices",
        json={
            "name": "Trimmed Narrator",
            "reference_audio": str(source_audio),
            "trim_start_seconds": 2,
            "trim_end_seconds": 6,
            "authorization_status": "authorized",
        },
    )

    assert response.status_code == 200
    voice = response.json()
    assert Path(voice["reference_audio"]).suffix == ".wav"
    assert Path(voice["reference_audio"]).is_file()
    assert commands and "-ss" in commands[0] and "-t" in commands[0]


def test_create_voice_transcodes_float_wav_to_managed_pcm16(tmp_path: Path, monkeypatch):
    voice_library_file = tmp_path / "voices.json"
    source_audio = tmp_path / "generated-float.wav"
    write_float_wav(source_audio)
    monkeypatch.setenv("OPEN_TTS_VOICE_LIBRARY_FILE", str(voice_library_file))
    get_settings.cache_clear()
    commands: list[list[str]] = []

    def fake_ffmpeg(command, **_kwargs):
        commands.append(command)
        write_sine_wav(Path(command[-1]), sample_rate=48000, duration_seconds=1)

    monkeypatch.setattr(voice_library.subprocess, "run", fake_ffmpeg)
    client = TestClient(app)
    response = client.post(
        "/v1/tts/voices",
        json={"name": "Float output", "reference_audio": str(source_audio), "authorization_status": "generated_local"},
    )

    assert response.status_code == 200
    voice = response.json()
    managed_path = Path(voice["reference_audio"])
    assert managed_path.suffix == ".wav"
    assert managed_path != source_audio
    with wave.open(str(managed_path), "rb") as wav_file:
        assert wav_file.getsampwidth() == 2
        assert wav_file.getnchannels() == 1
    assert commands and "pcm_s16le" in commands[0]


def test_repair_voice_audio_transcodes_existing_float_wav(tmp_path: Path, monkeypatch):
    voice_library_file = tmp_path / "voices.json"
    source_audio = tmp_path / "source.wav"
    write_sine_wav(source_audio, duration_seconds=5)
    monkeypatch.setenv("OPEN_TTS_VOICE_LIBRARY_FILE", str(voice_library_file))
    get_settings.cache_clear()
    client = TestClient(app)
    created = client.post(
        "/v1/tts/voices",
        json={"name": "Legacy float", "reference_audio": str(source_audio), "authorization_status": "authorized"},
    ).json()
    managed_path = Path(created["reference_audio"])
    write_float_wav(managed_path)
    commands: list[list[str]] = []

    def fake_ffmpeg(command, **_kwargs):
        commands.append(command)
        write_sine_wav(Path(command[-1]), sample_rate=48000, duration_seconds=1)

    monkeypatch.setattr(voice_library.subprocess, "run", fake_ffmpeg)
    response = client.post(f"/v1/tts/voices/{created['id']}/repair-audio")

    assert response.status_code == 200
    payload = response.json()
    assert payload["converted"] is True
    with wave.open(str(managed_path), "rb") as wav_file:
        assert wav_file.getsampwidth() == 2
        assert wav_file.getnchannels() == 1
    assert commands and "pcm_s16le" in commands[0]


def test_create_voice_rejects_incomplete_trim_range(tmp_path: Path, monkeypatch):
    source_audio = tmp_path / "source.wav"
    write_sine_wav(source_audio, duration_seconds=5)
    monkeypatch.setenv("OPEN_TTS_VOICE_LIBRARY_FILE", str(tmp_path / "voices.json"))
    get_settings.cache_clear()
    client = TestClient(app)

    response = client.post(
        "/v1/tts/voices",
        json={
            "name": "Broken Trim",
            "reference_audio": str(source_audio),
            "trim_start_seconds": 2,
            "authorization_status": "authorized",
        },
    )

    assert response.status_code == 422
    assert "起点和终点" in response.json()["detail"]


def test_create_voice_rejects_trim_without_reference_audio(tmp_path: Path, monkeypatch):
    monkeypatch.setenv("OPEN_TTS_VOICE_LIBRARY_FILE", str(tmp_path / "voices.json"))
    get_settings.cache_clear()
    client = TestClient(app)

    response = client.post(
        "/v1/tts/voices",
        json={
            "name": "Missing Audio",
            "trim_start_seconds": 2,
            "trim_end_seconds": 6,
            "authorization_status": "authorized",
        },
    )

    assert response.status_code == 422
    assert "参考音频" in response.json()["detail"]


def test_model_bound_voice_is_preserved_and_cannot_export_as_plain_voice_package(tmp_path: Path, monkeypatch):
    voice_library_file = tmp_path / "voices.json"
    source_audio = tmp_path / "source.wav"
    gpt_weights = tmp_path / "speaker.ckpt"
    sovits_weights = tmp_path / "speaker.pth"
    write_sine_wav(source_audio, duration_seconds=5)
    gpt_weights.write_bytes(b"gpt")
    sovits_weights.write_bytes(b"sovits")
    monkeypatch.setenv("OPEN_TTS_VOICE_LIBRARY_FILE", str(voice_library_file))
    get_settings.cache_clear()
    client = TestClient(app)

    created = client.post(
        "/v1/tts/voices",
        json={
            "name": "Fine-tuned Speaker",
            "reference_audio": str(source_audio),
            "authorization_status": "authorized",
            "source_type": "gptsovits_model_weights",
            "model_binding": {
                "model_id": "gptsovits",
                "weights": {
                    "gpt_weights_path": str(gpt_weights),
                    "sovits_weights_path": str(sovits_weights),
                },
            },
        },
    )

    assert created.status_code == 200
    voice = created.json()
    assert voice["model_binding"]["model_id"] == "gptsovits"
    listed = client.get("/v1/tts/voices").json()
    assert any(item["id"] == voice["id"] and item["model_binding"] for item in listed)

    export = client.post(f"/v1/tts/voices/{voice['id']}/export")
    assert export.status_code == 422
    assert "模型专属权重" in export.json()["detail"]


def test_voice_reference_recognition_returns_editable_transcript(tmp_path: Path, monkeypatch):
    voice_library_file = tmp_path / "voices.json"
    source_audio = tmp_path / "source.wav"
    write_sine_wav(source_audio, duration_seconds=5)
    monkeypatch.setenv("OPEN_TTS_VOICE_LIBRARY_FILE", str(voice_library_file))
    get_settings.cache_clear()
    captured = {"released": None, "reference_audio": None}

    class FakeSenseVoice:
        model_name = "sensevoice-small"
        runtime_model_id = "sensevoice"

        def __init__(self, settings):
            self.settings = settings

        def transcribe_path(self, reference_audio: Path, language: str = "zh") -> str:
            assert language == "zh"
            captured["reference_audio"] = str(reference_audio)
            return "自动识别出的参考音频原文。"

    monkeypatch.setattr(voice_routes, "get_local_transcriber", lambda _settings: FakeSenseVoice(_settings))
    monkeypatch.setattr(voice_routes, "release_conflicting_runtimes", lambda model_id, _settings: captured.update(released=model_id) or [])
    client = TestClient(app)
    created = client.post(
        "/v1/tts/voices",
        json={"name": "Narrator", "reference_audio": str(source_audio), "authorization_status": "authorized"},
    ).json()

    response = client.post(f"/v1/tts/voices/{created['id']}/recognize")

    assert response.status_code == 200
    assert response.json() == {"voice_id": created["id"], "text": "自动识别出的参考音频原文。"}
    assert captured["released"] == "sensevoice"
    assert captured["reference_audio"] == created["reference_audio"]


def test_voice_package_exports_and_imports_portably(tmp_path: Path, monkeypatch):
    voice_library_file = tmp_path / "voices.json"
    source_audio = tmp_path / "source.wav"
    alternate_audio = tmp_path / "alternate.wav"
    write_sine_wav(source_audio, duration_seconds=5)
    write_sine_wav(alternate_audio, duration_seconds=6)
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
    appended_response = client.post(
        f"/v1/tts/voices/{created['id']}/references",
        json={
            "name": "补充参考",
            "reference_audio": str(alternate_audio),
            "reference_text": "第二条可以带走的参考文本。",
        },
    )
    assert appended_response.status_code == 200
    appended = appended_response.json()
    second_reference = next(item for item in appended["references"] if item["name"] == "补充参考")
    activated_response = client.post(
        f"/v1/tts/voices/{created['id']}/references/{second_reference['id']}/activate"
    )
    assert activated_response.status_code == 200
    created = activated_response.json()

    export_response = client.post(f"/v1/tts/voices/{created['id']}/export")

    assert export_response.status_code == 200
    package_path = Path(export_response.json()["export_path"])
    assert package_path.is_file()
    with ZipFile(package_path) as package:
        package_references = created["references"]
        expected_audio = {
            f"audio/{reference['id']}.wav"
            for reference in package_references
        }
        assert set(package.namelist()) == {"voice.json", *expected_audio}
        manifest = json.loads(package.read("voice.json"))
        assert manifest["version"] == 2
        assert manifest["voice"]["active_reference_id"] == second_reference["id"]
        assert {reference["reference_audio"] for reference in manifest["voice"]["references"]} == expected_audio
        assert str(source_audio) not in package.read("voice.json").decode("utf-8")

    import_response = client.post("/v1/tts/voices/import", json={"package_path": str(package_path)})

    assert import_response.status_code == 200
    imported = import_response.json()
    assert imported["id"] != created["id"]
    assert imported["name"] == "Portable Narrator"
    assert len(imported["references"]) == 2
    active_reference = next(item for item in imported["references"] if item["id"] == imported["active_reference_id"])
    assert active_reference["name"] == "补充参考"
    assert imported["reference_text"] == "第二条可以带走的参考文本。"
    assert imported["reference_audio_managed"] is True
    assert Path(imported["reference_audio"]).is_file()


def test_voice_package_import_normalizes_float_wav(tmp_path: Path, monkeypatch):
    source_audio = tmp_path / "package-float.wav"
    package_path = tmp_path / "float-voice.zip"
    write_float_wav(source_audio)
    with ZipFile(package_path, "w") as package:
        package.writestr(
            "voice.json",
            json.dumps(
                {
                    "schema": "open-tts-voice-package",
                    "version": 1,
                    "voice": {
                        "name": "Float package",
                        "reference_audio": "audio/reference.wav",
                        "reference_audio_sha256": voice_library.file_sha256(source_audio),
                    },
                }
            ),
        )
        package.write(source_audio, "audio/reference.wav")
    monkeypatch.setenv("OPEN_TTS_VOICE_LIBRARY_FILE", str(tmp_path / "voices.json"))
    get_settings.cache_clear()

    def fake_ffmpeg(command, **_kwargs):
        write_sine_wav(Path(command[-1]), sample_rate=48000, duration_seconds=1)

    monkeypatch.setattr(voice_library.subprocess, "run", fake_ffmpeg)
    client = TestClient(app)
    response = client.post("/v1/tts/voices/import", json={"package_path": str(package_path)})

    assert response.status_code == 200
    assert response.json()["references"][0]["id"] == response.json()["active_reference_id"]
    with wave.open(response.json()["reference_audio"], "rb") as wav_file:
        assert wav_file.getsampwidth() == 2
        assert wav_file.getnchannels() == 1


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
