from pathlib import Path
import json

from tts_api.adapters.gptsovits import GptSoVitsAdapter, GptSoVitsServiceManager
from tts_api.config import Settings
from tts_api.schemas import SpeechRequest


class FakeHttpResponse:
    def __init__(self, content: bytes = b"RIFFfake-wav", status_code: int = 200):
        self.content = content
        self.status_code = status_code

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            raise RuntimeError(f"HTTP {self.status_code}")


class FakeHttpClient:
    def __init__(self):
        self.get_calls = []
        self.post_calls = []

    def get(self, url: str, timeout: float):
        self.get_calls.append({"url": url, "timeout": timeout})
        return FakeHttpResponse(content=b'{"status":"ok"}')

    def post(self, url: str, json: dict, timeout: float):
        self.post_calls.append({"url": url, "json": json, "timeout": timeout})
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


def test_gptsovits_service_manager_builds_lazy_pack_command(tmp_path: Path):
    root = tmp_path / "GPT-SoVITS-v2pro-20250604"
    runtime = root / "runtime"
    runtime.mkdir(parents=True)
    (runtime / "python.exe").write_text("python", encoding="utf-8")
    (root / "api_v2.py").write_text("api", encoding="utf-8")
    config = root / "GPT_SoVITS" / "configs"
    config.mkdir(parents=True)
    (config / "tts_infer.yaml").write_text("config", encoding="utf-8")
    settings = Settings(
        gptsovits_root=root,
        gptsovits_api_host="127.0.0.1",
        gptsovits_api_port=9888,
    )
    manager = GptSoVitsServiceManager(settings=settings)

    command = manager.build_command()

    assert command[0] == str(root / "runtime" / "python.exe")
    assert command[1] == str(root / "api_v2.py")
    assert "-a" in command
    assert "127.0.0.1" in command
    assert "-p" in command
    assert "9888" in command
    assert "-c" in command
    assert str(root / "GPT_SoVITS" / "configs" / "tts_infer.yaml") in command


def test_gptsovits_adapter_posts_clone_request_to_local_api(tmp_path: Path):
    reference_audio = tmp_path / "ref.wav"
    reference_audio.write_bytes(b"RIFFref")
    settings = Settings(
        output_dir=tmp_path / "outputs",
        gptsovits_root=tmp_path / "GPT-SoVITS",
        gptsovits_api_port=9889,
    )
    client = FakeHttpClient()
    adapter = GptSoVitsAdapter(settings=settings, http_client=client, service_manager=None)
    request = SpeechRequest(
        model="gptsovits",
        input="这是 GPT-SoVITS 输出。",
        reference_audio=str(reference_audio),
        reference_text="这是参考音频文本。",
        language="zh",
        speed=1.2,
    )

    result = adapter.synthesize(request)

    assert result.model == "gptsovits"
    assert result.sample_rate == 32000
    assert Path(result.file_path).exists()
    assert client.post_calls[0]["url"] == "http://127.0.0.1:9889/tts"
    payload = client.post_calls[0]["json"]
    assert payload["text"] == "这是 GPT-SoVITS 输出。"
    assert payload["text_lang"] == "zh"
    assert payload["ref_audio_path"] == str(reference_audio)
    assert payload["prompt_text"] == "这是参考音频文本。"
    assert payload["prompt_lang"] == "zh"
    assert payload["text_split_method"] == "cut5"
    assert payload["media_type"] == "wav"
    assert payload["streaming_mode"] is False
    assert payload["speed_factor"] == 1.2


def test_gptsovits_adapter_requires_reference_audio(tmp_path: Path):
    settings = Settings(output_dir=tmp_path / "outputs")
    adapter = GptSoVitsAdapter(settings=settings, service_manager=None)
    request = SpeechRequest(model="gptsovits", input="hello")

    try:
        adapter.synthesize(request)
    except ValueError as exc:
        assert "reference audio" in str(exc)
    else:
        raise AssertionError("Expected GPT-SoVITS to require a reference audio file.")


def test_gptsovits_adapter_switches_to_model_bound_voice_weights(tmp_path: Path, monkeypatch):
    reference_audio = tmp_path / "nanami-ref.wav"
    gpt_weights = tmp_path / "nanami.ckpt"
    sovits_weights = tmp_path / "nanami.pth"
    for path in (reference_audio, gpt_weights, sovits_weights):
        path.write_bytes(b"model-data")
    voice_library_file = tmp_path / "voices.json"
    voice_library_file.write_text(
        json.dumps(
            {
                "voices": [
                    {
                        "id": "nanami",
                        "name": "娜娜米",
                        "reference_audio": str(reference_audio),
                        "authorization_status": "authorized",
                        "source_type": "gptsovits_model_weights",
                        "reference_audio_managed": False,
                        "model_binding": {
                            "model_id": "gptsovits",
                            "weights": {
                                "gpt_weights_path": str(gpt_weights),
                                "sovits_weights_path": str(sovits_weights),
                            },
                        },
                    }
                ]
            }
        ),
        encoding="utf-8",
    )
    settings = Settings(
        output_dir=tmp_path / "outputs",
        gptsovits_root=tmp_path / "GPT-SoVITS",
        gptsovits_api_port=9889,
        voice_library_file=voice_library_file,
    )
    client = FakeHttpClient()
    adapter = GptSoVitsAdapter(settings=settings, http_client=client, service_manager=None)

    adapter.synthesize(
        SpeechRequest(
            model="gptsovits",
            input="这是专属权重音色输出。",
            voice="nanami",
            reference_audio=str(reference_audio),
        )
    )

    assert len(client.get_calls) == 2
    assert "set_gpt_weights" in client.get_calls[0]["url"]
    assert "nanami.ckpt" in client.get_calls[0]["url"]
    assert "set_sovits_weights" in client.get_calls[1]["url"]
    assert "nanami.pth" in client.get_calls[1]["url"]


def test_gptsovits_service_manager_reads_relative_default_weight_pair(tmp_path: Path):
    root = tmp_path / "GPT-SoVITS"
    config = root / "GPT_SoVITS" / "configs"
    config.mkdir(parents=True)
    (root / "weights").mkdir()
    gpt_weights = root / "weights" / "default.ckpt"
    sovits_weights = root / "weights" / "default.pth"
    gpt_weights.write_bytes(b"gpt")
    sovits_weights.write_bytes(b"sovits")
    (config / "tts_infer.yaml").write_text(
        "custom:\n  t2s_weights_path: weights/default.ckpt\n  vits_weights_path: weights/default.pth\n",
        encoding="utf-8",
    )
    manager = GptSoVitsServiceManager(settings=Settings(gptsovits_root=root))

    assert manager.default_weight_pair() == (str(gpt_weights.resolve()), str(sovits_weights.resolve()))


def test_gptsovits_managed_service_releases_after_idle_timeout(tmp_path: Path):
    current_time = [100.0]
    manager = GptSoVitsServiceManager(
        settings=Settings(gptsovits_root=tmp_path, local_api_idle_timeout_seconds=30),
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
