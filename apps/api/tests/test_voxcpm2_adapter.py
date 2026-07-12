from pathlib import Path

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
    def __init__(self, content: bytes = b"RIFFfake-wav", status_code: int = 200):
        self.content = content
        self.status_code = status_code

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            raise RuntimeError(f"HTTP {self.status_code}")


class FakeHttpClient:
    def __init__(self):
        self.post_calls = []
        self.get_calls = []

    def get(self, url: str, timeout: float):
        self.get_calls.append({"url": url, "timeout": timeout})
        return FakeHttpResponse(content=b'{"status":"ok"}')

    def post(self, url: str, data: dict, files: dict | None, timeout: float):
        self.post_calls.append({"url": url, "data": data, "files": files, "timeout": timeout})
        return FakeHttpResponse()


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
    assert client.post_calls[0]["data"]["control_instruction"] == "温柔一点"
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

    status = manager.status()

    assert status["state"] == "external"
    assert status["managed"] is False
    assert status["can_stop"] is False
