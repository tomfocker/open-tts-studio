from pathlib import Path

import pytest

from tts_api.adapters.indextts2 import IndexTts2Adapter
from tts_api.audio import write_sine_wav
from tts_api.config import Settings
from tts_api.schemas import SpeechRequest


def test_indextts2_adapter_builds_lazy_pack_command(tmp_path: Path):
    lazy_pack_root = Path("D:/AI/IndexTTS2")
    settings = Settings(
        workspace_root=Path("D:/code/tts"),
        output_dir=tmp_path,
        indextts2_root=lazy_pack_root,
    )
    adapter = IndexTts2Adapter(settings=settings)
    request = SpeechRequest(
        model="indextts2",
        input="hello",
        reference_audio="D:/AI/IndexTTS2/Index-TTS/examples/voice_01.wav",
        emotion="calm and natural",
    )

    command, output_path = adapter.build_command(request)

    assert command[0] == str(lazy_pack_root / "WPy64-310110" / "python-3.10.11.amd64" / "python.exe")
    assert command[1].endswith("run_indextts2.py")
    assert "--source-dir" in command
    assert str(lazy_pack_root / "Index-TTS") in command
    assert "--model-dir" in command
    assert str(lazy_pack_root / "Index-TTS" / "checkpoints") in command
    assert "--text" in command
    assert "hello" in command
    assert "--prompt-audio" in command
    assert "D:/AI/IndexTTS2/Index-TTS/examples/voice_01.wav" in command
    assert "--emotion-text" in command
    assert "calm and natural" in command
    assert "--fp16" in command
    assert output_path.suffix == ".wav"


def test_indextts2_adapter_uses_lazy_pack_environment(tmp_path: Path):
    lazy_pack_root = Path("D:/AI/IndexTTS2")
    settings = Settings(output_dir=tmp_path, indextts2_root=lazy_pack_root)
    adapter = IndexTts2Adapter(settings=settings)

    environment = adapter.build_environment()

    assert environment["HF_HOME"] == str(lazy_pack_root / "models")
    assert environment["XDG_CACHE_HOME"] == str(lazy_pack_root / "models")
    assert environment["HF_ENDPOINT"] == "https://hf-mirror.com"
    assert environment["HF_HUB_OFFLINE"] == "1"
    assert environment["TRANSFORMERS_OFFLINE"] == "1"
    assert str(lazy_pack_root / "ffmpeg") in environment["PATH"]
    assert str(lazy_pack_root / "WPy64-310110" / "python-3.10.11.amd64") in environment["PATH"]


def test_indextts2_adapter_reports_wav_metadata(tmp_path: Path, monkeypatch):
    class FakeWorkerClient:
        def synthesize(self, request, output_path, prompt_audio):
            write_sine_wav(output_path, sample_rate=22050, duration_seconds=0.25)
            return output_path

    settings = Settings(output_dir=tmp_path, indextts2_root=Path("D:/AI/IndexTTS2"))
    adapter = IndexTts2Adapter(settings=settings, worker_client=FakeWorkerClient())
    request = SpeechRequest(model="indextts2", input="hello")

    result = adapter.synthesize(request)

    assert result.sample_rate == 22050
    assert result.duration_seconds == pytest.approx(0.25, abs=0.001)


def test_indextts2_adapter_uses_persistent_worker_client(tmp_path: Path):
    class FakeWorkerClient:
        def __init__(self):
            self.calls = 0

        def synthesize(self, request, output_path, prompt_audio):
            self.calls += 1
            write_sine_wav(output_path, sample_rate=22050, duration_seconds=0.2)
            return output_path

    worker_client = FakeWorkerClient()
    settings = Settings(output_dir=tmp_path, indextts2_root=Path("D:/AI/IndexTTS2"))
    adapter = IndexTts2Adapter(settings=settings, worker_client=worker_client)
    request = SpeechRequest(model="indextts2", input="hello")

    first = adapter.synthesize(request)
    second = adapter.synthesize(request)

    assert worker_client.calls == 2
    assert first.file_path != second.file_path
    assert first.sample_rate == 22050
    assert second.duration_seconds == pytest.approx(0.2, abs=0.001)
