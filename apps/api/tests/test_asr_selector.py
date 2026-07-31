from pathlib import Path

from fastapi.testclient import TestClient

from tts_api.adapters import asr
from tts_api.config import Settings, get_settings
from tts_api.main import create_app
from tts_api.routes import transcriptions


def test_asr_backend_selects_qwen_without_changing_tts_or_alignment():
    settings = Settings(asr_backend="qwen3")

    selected = asr.get_local_transcriber(settings)

    assert selected.model_name == "qwen3-asr-1.7b"
    assert selected.runtime_model_id == "qwen3-asr"
    assert settings.alignment_model_version == "qwen3-forced-aligner-0.6b"
    assert settings.qwen_asr_device == "auto"
    assert settings.alignment_device == "auto"


def test_transcription_endpoint_reports_selected_qwen_backend(tmp_path: Path, monkeypatch):
    class FakeQwen:
        model_name = "qwen3-asr-1.7b"
        runtime_model_id = "qwen3-asr"

        def transcribe_upload(self, stream, filename: str, language: str = "zh") -> str:
            assert filename == "reference.wav"
            assert language == "zh"
            assert stream.read() == b"local-audio"
            return "Qwen 本地转写"

    monkeypatch.setenv("OPEN_TTS_SETTINGS_FILE", str(tmp_path / "settings.json"))
    monkeypatch.setenv("OPEN_TTS_TASKS_FILE", str(tmp_path / "tasks.json"))
    monkeypatch.setenv("OPEN_TTS_OUTPUT_DIR", str(tmp_path / "outputs"))
    monkeypatch.setattr(transcriptions, "get_local_transcriber", lambda _settings: FakeQwen())
    monkeypatch.setattr(transcriptions, "release_conflicting_runtimes", lambda model_id, _settings: [model_id])
    get_settings.cache_clear()
    client = TestClient(create_app())

    response = client.post(
        "/v1/audio/transcriptions",
        data={"language": "zh"},
        files={"file": ("reference.wav", b"local-audio", "audio/wav")},
    )

    assert response.status_code == 200
    assert response.json() == {"text": "Qwen 本地转写", "language": "zh", "model": "qwen3-asr-1.7b"}


def test_asr_backend_switch_is_persisted_in_runtime_settings(tmp_path: Path, monkeypatch):
    monkeypatch.setenv("OPEN_TTS_SETTINGS_FILE", str(tmp_path / "settings.json"))
    monkeypatch.setenv("OPEN_TTS_TASKS_FILE", str(tmp_path / "tasks.json"))
    monkeypatch.setenv("OPEN_TTS_OUTPUT_DIR", str(tmp_path / "outputs"))
    get_settings.cache_clear()
    client = TestClient(create_app())

    response = client.patch("/v1/settings", json={"asr_backend": "qwen3"})

    assert response.status_code == 200
    assert response.json()["asr_backend"] == "qwen3"
    assert '"asr_backend": "qwen3"' in (tmp_path / "settings.json").read_text(encoding="utf-8")
