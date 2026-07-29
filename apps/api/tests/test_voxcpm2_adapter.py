from pathlib import Path

import httpx

from tts_api.adapters.voxcpm2 import VoxCpm2Adapter, VoxCpm2ServiceManager
from tts_api.config import Settings
from tts_api.schemas import SpeechRequest


def test_voxcpm2_adapter_builds_expected_command(tmp_path: Path):
    settings = Settings(output_dir=tmp_path)
    adapter = VoxCpm2Adapter(settings=settings, python_executable="D:/runtime/voxcpm2/python.exe")
    request = SpeechRequest(
        model="voxcpm2",
        input="hello",
        voice_prompt="young warm voice",
        reference_audio="D:/voices/ref.wav",
    )

    command, output_path = adapter.build_command(request)

    assert command[0] == "D:/runtime/voxcpm2/python.exe"
    assert "tools/run_voxcpm2.py" in command
    assert "--text" in command
    assert "hello" in command
    assert "--voice-prompt" in command
    assert "young warm voice" in command
    assert "--reference-audio" in command
    assert "D:/voices/ref.wav" in command
    assert output_path.suffix == ".wav"


class FakeHttpResponse:
    def __init__(self, content: bytes = b"RIFFfake-wav", status_code: int = 200, payload: dict | None = None):
        self.content = content
        self.status_code = status_code
        self.payload = payload or {"status": "ok", "models_loaded": {"all_ready": True}}

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            raise RuntimeError(f"HTTP {self.status_code}")

    def json(self) -> dict:
        return self.payload


class FakeHttpClient:
    def __init__(self):
        self.post_calls = []
        self.get_calls = []

    def get(self, url: str, timeout: float):
        self.get_calls.append({"url": url, "timeout": timeout})
        return FakeHttpResponse(content=b'{"status":"ok"}')

    def post(self, url: str, data: dict | None = None, files: dict | None = None, timeout: float = 0):
        self.post_calls.append({"url": url, "data": data, "files": files, "timeout": timeout})
        return FakeHttpResponse()


class TimeoutHttpClient(FakeHttpClient):
    def post(self, url: str, data: dict | None = None, files: dict | None = None, timeout: float = 0):
        self.post_calls.append({"url": url, "data": data, "files": files, "timeout": timeout})
        raise httpx.ReadTimeout("model did not respond")


class WarmingVoxHttpClient(FakeHttpClient):
    def __init__(self):
        super().__init__()
        self.ready_states = [False, True]

    def get(self, url: str, timeout: float):
        self.get_calls.append({"url": url, "timeout": timeout})
        ready = self.ready_states.pop(0) if self.ready_states else True
        return FakeHttpResponse(payload={"status": "ok", "models_loaded": {"all_ready": ready}})


class FakeProcess:
    def __init__(self):
        self.returncode = None

    def poll(self):
        return self.returncode

    def terminate(self):
        self.returncode = 0


class ManualTimer:
    callback = None

    def __init__(self, delay, callback):
        self.delay = delay
        self.callback = callback
        ManualTimer.callback = callback
        self.cancelled = False
        self.daemon = False

    def start(self):
        return None

    def cancel(self):
        self.cancelled = True


def test_voxcpm2_adapter_posts_extreme_clone_request_to_local_api(tmp_path: Path):
    reference_audio = tmp_path / "ref.wav"
    reference_audio.write_bytes(b"RIFFref")
    settings = Settings(
        output_dir=tmp_path / "outputs",
        voxcpm2_api_port=8012,
        voxcpm2_root=tmp_path / "VoxCPM2",
    )
    client = FakeHttpClient()
    adapter = VoxCpm2Adapter(settings=settings, http_client=client, service_manager=None)
    request = SpeechRequest(
        model="voxcpm2",
        input="这是极致克隆输出。",
        emotion="温柔一点",
        reference_audio=str(reference_audio),
        reference_text="这是参考音频原文。",
    )

    result = adapter.synthesize(request)

    assert result.model == "voxcpm2"
    assert result.sample_rate == 48000
    assert Path(result.file_path).exists()
    assert client.post_calls[0]["url"] == "http://127.0.0.1:8012/tts"
    assert client.post_calls[0]["data"]["text"] == "这是极致克隆输出。"
    assert client.post_calls[0]["data"]["control_instruction"] == ""
    assert client.post_calls[0]["data"]["prompt_text"] == "这是参考音频原文。"
    assert "prompt_audio" in client.post_calls[0]["files"]


def test_voxcpm2_adapter_posts_voice_design_without_audio(tmp_path: Path):
    settings = Settings(output_dir=tmp_path / "outputs", voxcpm2_api_port=8013)
    client = FakeHttpClient()
    adapter = VoxCpm2Adapter(settings=settings, http_client=client, service_manager=None)
    request = SpeechRequest(
        model="voxcpm2",
        input="这是音色设计输出。",
        emotion="年轻女性，声音清亮",
    )

    adapter.synthesize(request)

    assert client.post_calls[0]["data"]["control_instruction"] == "年轻女性，声音清亮"
    assert client.post_calls[0]["data"]["prompt_text"] is None
    assert client.post_calls[0]["files"] is None


def test_voxcpm2_adapter_forwards_exposed_generation_controls(tmp_path: Path):
    settings = Settings(output_dir=tmp_path / "outputs", voxcpm2_api_port=8014)
    client = FakeHttpClient()
    adapter = VoxCpm2Adapter(settings=settings, http_client=client, service_manager=None)

    adapter.synthesize(
        SpeechRequest(
            model="voxcpm2",
            input="参数转发测试。",
            cfg=2.7,
            inference_steps=18,
            normalize=False,
            denoise=True,
        )
    )

    payload = client.post_calls[0]["data"]
    assert payload["cfg_value"] == "2.7"
    assert payload["inference_timesteps"] == "18"
    assert payload["normalize"] == "false"
    assert payload["denoise"] == "true"


def test_voxcpm2_extreme_clone_ignores_voice_design_instruction(tmp_path: Path):
    reference_audio = tmp_path / "ref.wav"
    reference_audio.write_bytes(b"RIFFref")
    client = FakeHttpClient()
    adapter = VoxCpm2Adapter(settings=Settings(output_dir=tmp_path), http_client=client, service_manager=None)

    adapter.synthesize(
        SpeechRequest(
            model="voxcpm2",
            input="极致克隆不应混入音色设计。",
            reference_audio=str(reference_audio),
            reference_text="参考音频实际说的内容。",
            emotion="低沉男声，磁性嗓音",
        )
    )

    assert client.post_calls[0]["data"]["prompt_text"] == "参考音频实际说的内容。"
    assert client.post_calls[0]["data"]["control_instruction"] == ""


def test_voxcpm2_adapter_recognizes_reference_audio(tmp_path: Path):
    reference_audio = tmp_path / "reference.mp3"
    reference_audio.write_bytes(b"fake-mp3")
    client = FakeHttpClient()
    client.post = lambda url, data=None, files=None, timeout=0: (
        client.post_calls.append({"url": url, "data": data, "files": files, "timeout": timeout})
        or FakeHttpResponse(payload={"text": "这是参考音频实际说的内容。"})
    )
    adapter = VoxCpm2Adapter(settings=Settings(output_dir=tmp_path), http_client=client, service_manager=None)

    text = adapter.recognize_reference_audio(str(reference_audio))

    assert text == "这是参考音频实际说的内容。"
    assert client.post_calls[0]["url"].endswith("/recognize")
    assert client.post_calls[0]["files"]["audio"][0] == "reference.mp3"


def test_voxcpm2_adapter_stops_a_managed_service_after_generation_timeout(tmp_path: Path):
    settings = Settings(output_dir=tmp_path / "outputs", voxcpm2_api_port=8015)
    manager = VoxCpm2ServiceManager(settings=settings, http_client=FakeHttpClient())
    manager.process = FakeProcess()
    adapter = VoxCpm2Adapter(
        settings=settings,
        http_client=TimeoutHttpClient(),
        service_manager=manager,
        request_timeout_seconds=12,
    )

    try:
        adapter.synthesize(SpeechRequest(model="voxcpm2", input="超时保护测试。"))
    except RuntimeError as exc:
        assert "12 秒" in str(exc)
    else:
        raise AssertionError("expected a generation timeout")

    assert manager.process is None


def test_voxcpm2_waits_for_background_preload_before_accepting_generation(tmp_path: Path):
    client = WarmingVoxHttpClient()
    manager = VoxCpm2ServiceManager(
        settings=Settings(voxcpm2_root=tmp_path),
        http_client=client,
        sleep=lambda _seconds: None,
    )
    manager.process = FakeProcess()

    manager.ensure_started()

    assert len(client.get_calls) >= 2
    assert manager.process is not None


def test_voxcpm2_managed_service_releases_after_idle_timeout(tmp_path: Path):
    current_time = [100.0]
    manager = VoxCpm2ServiceManager(
        settings=Settings(voxcpm2_root=tmp_path, local_api_idle_timeout_seconds=30),
        http_client=FakeHttpClient(),
        timer_factory=ManualTimer,
        now_factory=lambda: current_time[0],
    )
    process = FakeProcess()
    manager.process = process
    manager.last_used_at = current_time[0]
    manager._schedule_idle_release()

    current_time[0] = 131.0
    assert ManualTimer.callback is not None
    ManualTimer.callback()

    assert process.returncode == 0
    assert manager.status()["managed"] is False


def test_voxcpm2_external_service_is_never_marked_stoppable(tmp_path: Path):
    manager = VoxCpm2ServiceManager(settings=Settings(voxcpm2_root=tmp_path), http_client=FakeHttpClient())

    status = manager.status(probe_timeout_seconds=2)

    assert status["state"] == "external"
    assert status["managed"] is False
    assert status["can_stop"] is False
