from pathlib import Path

from fastapi.testclient import TestClient

from tts_api.adapters.mock import MockTtsAdapter
from tts_api.config import Settings, get_settings
from tts_api.main import app, create_app
from tts_api.routes import speech
from tts_api.schemas import SpeechRequest, SpeechResult


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


def test_speech_endpoint_rejects_regular_local_engine_while_realtime_owns_gpu(monkeypatch):
    client = TestClient(app)
    monkeypatch.setattr(speech, "is_realtime_runtime_reserved", lambda: True)

    response = client.post("/v1/audio/speech", json={"model": "voxcpm2", "input": "不应切走实时模型"})

    assert response.status_code == 409
    assert "实时语音模式正在独占 GPU" in response.json()["detail"]


def test_cloud_speech_bypasses_the_local_gpu_lock(tmp_path: Path, monkeypatch):
    monkeypatch.setenv("OPEN_TTS_SETTINGS_FILE", str(tmp_path / "settings.json"))
    monkeypatch.setenv("OPEN_TTS_TASKS_FILE", str(tmp_path / "tasks.json"))
    monkeypatch.setenv("OPEN_TTS_TASK_LOG_DIR", str(tmp_path / "task-logs"))
    get_settings.cache_clear()
    calls: list[str] = []

    class ForbiddenLock:
        def __enter__(self):
            calls.append("gpu-lock")
            raise AssertionError("云端豆包不应等待或占用本地 GPU 锁")

        def __exit__(self, *_args):
            return False

    class FakeDoubaoAdapter:
        def __init__(self, **_kwargs):
            pass

        def synthesize(self, request: SpeechRequest) -> SpeechResult:
            return SpeechResult(
                audio_url="/outputs/cloud.mp3",
                file_path=str(tmp_path / "cloud.mp3"),
                model=request.model,
                sample_rate=24000,
                duration_seconds=0.5,
            )

    monkeypatch.setattr(speech, "local_gpu_generation_lock", ForbiddenLock())
    monkeypatch.setattr(speech, "release_conflicting_runtimes", lambda *_args: (_ for _ in ()).throw(AssertionError("云端不应清理本地运行时")))
    monkeypatch.setattr(speech, "DoubaoWebAdapter", FakeDoubaoAdapter)
    client = TestClient(create_app())

    response = client.post("/v1/audio/speech", json={"model": "doubao-web", "input": "云端不等本地显存"})

    assert response.status_code == 200
    assert response.json()["model"] == "doubao-web"
    assert calls == []
    events = client.get("/v1/tts/jobs").json()[0]["events"]
    assert any(event["stage"] == "waiting_cloud_request" for event in events)
    assert all(event["stage"] != "waiting_generation_slot" for event in events)


def test_speech_endpoint_rejects_disabled_model_before_starting_runtime(tmp_path: Path, monkeypatch):
    monkeypatch.setenv("OPEN_TTS_SETTINGS_FILE", str(tmp_path / "settings.json"))
    get_settings.cache_clear()
    client = TestClient(create_app())

    update_response = client.patch("/v1/model-instances/voxcpm2", json={"enabled": False})
    assert update_response.status_code == 200

    response = client.post("/v1/audio/speech", json={"model": "voxcpm2", "input": "hello"})

    assert response.status_code == 409
    assert "disabled" in response.json()["detail"]


def test_speech_endpoint_rejects_a_missing_model_package_before_starting_runtime(tmp_path: Path, monkeypatch):
    monkeypatch.setenv("OPEN_TTS_SETTINGS_FILE", str(tmp_path / "settings.json"))
    monkeypatch.setenv("OPEN_TTS_VOXCPM2_ROOT", str(tmp_path / "missing-voxcpm2"))
    get_settings.cache_clear()
    client = TestClient(create_app())

    response = client.post("/v1/audio/speech", json={"model": "voxcpm2", "input": "hello"})

    assert response.status_code == 409
    assert "模型目录" in response.json()["detail"]
