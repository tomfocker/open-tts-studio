from pathlib import Path

from fastapi.testclient import TestClient

from tts_api.adapters.sensevoice import SenseVoiceTranscriber
from tts_api.config import Settings, get_settings
from tts_api.main import create_app
from tts_api.routes import realtime, transcriptions


class FakeResponse:
    def __init__(self, payload: dict):
        self.payload = payload

    def raise_for_status(self) -> None:
        return None

    def json(self) -> dict:
        return self.payload


class FakeHttpClient:
    def __init__(self):
        self.calls: list[dict] = []

    def post(self, url, data, files, timeout):
        self.calls.append({"url": url, "data": data, "files": files, "timeout": timeout})
        return FakeResponse({"text": "本地识别结果", "language": "zh", "model": "sensevoice-small"})


class FakeManager:
    api_base = "http://127.0.0.1:8014"

    def __init__(self):
        self.started = 0
        self.began = 0
        self.finished = 0

    def ensure_started(self):
        self.started += 1

    def begin_request(self):
        self.began += 1

    def finish_request(self):
        self.finished += 1

    def force_shutdown(self):
        raise AssertionError("unexpected timeout")


def test_independent_sensevoice_client_posts_final_audio_to_loopback_only(tmp_path: Path):
    audio = tmp_path / "final.wav"
    audio.write_bytes(b"RIFFlocal-final-audio")
    client = FakeHttpClient()
    manager = FakeManager()

    text = SenseVoiceTranscriber(
        settings=Settings(output_dir=tmp_path),
        http_client=client,
        service_manager=manager,
    ).transcribe_path(audio)

    assert text == "本地识别结果"
    assert manager.started == manager.began == manager.finished == 1
    assert client.calls[0]["url"] == "http://127.0.0.1:8014/transcribe"
    assert client.calls[0]["files"]["audio"][0] == "final.wav"
    assert client.calls[0]["data"] == {"language": "zh", "use_itn": "true"}


def test_openai_style_transcription_endpoint_uses_shared_local_asr(tmp_path: Path, monkeypatch):
    class FakeTranscriber:
        model_name = "sensevoice-small"
        runtime_model_id = "sensevoice"

        def __init__(self, _settings):
            pass

        def transcribe_upload(self, stream, filename: str, language: str = "zh") -> str:
            assert filename == "narration.wav"
            assert language == "zh"
            assert stream.read() == b"local-audio"
            return "旁白转写"

    monkeypatch.setenv("OPEN_TTS_SETTINGS_FILE", str(tmp_path / "settings.json"))
    monkeypatch.setenv("OPEN_TTS_TASKS_FILE", str(tmp_path / "tasks.json"))
    monkeypatch.setenv("OPEN_TTS_OUTPUT_DIR", str(tmp_path / "outputs"))
    monkeypatch.setattr(transcriptions, "get_local_transcriber", lambda _settings: FakeTranscriber(_settings))
    monkeypatch.setattr(transcriptions, "release_conflicting_runtimes", lambda model_id, _settings: [model_id])
    get_settings.cache_clear()
    client = TestClient(create_app())

    response = client.post(
        "/v1/audio/transcriptions",
        data={"language": "zh"},
        files={"file": ("narration.wav", b"local-audio", "audio/wav")},
    )

    assert response.status_code == 200
    assert response.json() == {"text": "旁白转写", "language": "zh", "model": "sensevoice-small"}


def test_sensevoice_defaults_do_not_discover_vox_assets():
    settings = Settings()

    assert settings.sensevoice_model_dir == settings.workspace_root / "models" / "SenseVoiceSmall"
    assert settings.sensevoice_python == settings.workspace_root / "models" / "SenseVoiceSmall" / "runtime" / "python.exe"
    assert "VoxCPM2" not in str(settings.sensevoice_model_dir)
    assert "VoxCPM2" not in str(settings.sensevoice_python)


def test_realtime_asr_uses_the_configured_independent_transcriber(tmp_path: Path, monkeypatch):
    audio = tmp_path / "turn.wav"
    audio.write_bytes(b"local-pcm")
    calls: list[object] = []

    class FakeTranscriber:
        runtime_model_id = "sensevoice"

        def transcribe_path(self, path: Path, language: str = "zh") -> str:
            calls.append((path, language))
            return "实时识别文本"

    settings = Settings(output_dir=tmp_path)
    monkeypatch.setattr(realtime, "_save_pcm16_wav", lambda _payload: audio)
    monkeypatch.setattr(realtime, "get_settings", lambda: settings)
    monkeypatch.setattr(realtime, "resolve_runtime_settings", lambda value: value)
    monkeypatch.setattr(realtime, "get_local_transcriber", lambda _settings: FakeTranscriber())
    monkeypatch.setattr(realtime, "release_conflicting_runtimes", lambda model_id, _settings: calls.append(model_id))

    assert realtime._run_asr(b"pcm") == "实时识别文本"
    assert calls == ["sensevoice", (audio, "zh")]
    assert not audio.exists()
