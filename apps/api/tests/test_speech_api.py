from pathlib import Path

from fastapi.testclient import TestClient

from tts_api.adapters.mock import MockTtsAdapter
from tts_api.config import Settings, get_settings
from tts_api.main import app, create_app
from tts_api.routes import speech
from tts_api.schemas import SpeechRequest


def test_mock_adapter_writes_wav_file(tmp_path: Path):
    settings = Settings(output_dir=tmp_path)
    adapter = MockTtsAdapter(settings=settings)
    request = SpeechRequest(model="mock-tts", input="hello")

    result = adapter.synthesize(request)

    output_path = Path(result.file_path)
    assert output_path.exists()
    assert output_path.suffix == ".wav"
    assert result.model == "mock-tts"
    assert result.sample_rate == 24000
    assert result.duration_seconds > 0


def test_openai_compatible_speech_endpoint_returns_audio_file():
    client = TestClient(app)
    response = client.post(
        "/v1/audio/speech",
        json={"model": "mock-tts", "input": "hello", "response_format": "wav"},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["model"] == "mock-tts"
    assert body["audio_url"].endswith(".wav")
    assert body["sample_rate"] == 24000


def test_speech_endpoint_rejects_unknown_model():
    client = TestClient(app)
    response = client.post(
        "/v1/audio/speech",
        json={"model": "missing-model", "input": "hello"},
    )

    assert response.status_code == 404
    assert response.json()["detail"] == "Unknown model: missing-model"


def test_speech_endpoint_rejects_parameters_not_exposed_by_the_adapter():
    client = TestClient(app)

    response = client.post(
        "/v1/audio/speech",
        json={"model": "mock-tts", "input": "hello", "emotion": "温柔一点"},
    )

    assert response.status_code == 400
    assert "不支持参数：emotion" in response.json()["detail"]


def test_speech_endpoint_rejects_gptsovits_without_reference_audio_before_starting_service():
    client = TestClient(app)

    response = client.post(
        "/v1/audio/speech",
        json={"model": "gptsovits", "input": "hello"},
    )

    assert response.status_code == 400
    assert "必须提供 reference_audio" in response.json()["detail"]


def test_speech_endpoint_rejects_formats_not_implemented_by_the_local_backend():
    client = TestClient(app)

    response = client.post(
        "/v1/audio/speech",
        json={"model": "mock-tts", "input": "hello", "response_format": "mp3"},
    )

    assert response.status_code == 400
    assert "WAV" in response.json()["detail"]


def test_speech_endpoint_reports_external_runtime_memory_conflict(monkeypatch):
    client = TestClient(app)
    monkeypatch.setattr(
        speech,
        "release_conflicting_runtimes",
        lambda _model_id, _settings: (_ for _ in ()).throw(RuntimeError("检测到外部启动的 VoxCPM2 服务占用显存")),
    )

    response = client.post("/v1/audio/speech", json={"model": "mock-tts", "input": "hello"})

    assert response.status_code == 409
    assert "外部启动" in response.json()["detail"]


def test_speech_endpoint_rejects_disabled_model_before_starting_runtime(tmp_path: Path, monkeypatch):
    monkeypatch.setenv("OPEN_TTS_SETTINGS_FILE", str(tmp_path / "settings.json"))
    get_settings.cache_clear()
    client = TestClient(create_app())

    update_response = client.patch("/v1/model-instances/voxcpm2", json={"enabled": False})
    assert update_response.status_code == 200

    response = client.post("/v1/audio/speech", json={"model": "voxcpm2", "input": "hello"})

    assert response.status_code == 409
    assert "disabled" in response.json()["detail"]
