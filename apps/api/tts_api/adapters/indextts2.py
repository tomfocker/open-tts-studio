import os
from pathlib import Path
from typing import Protocol

from tts_api.adapters.base import TtsAdapter
from tts_api.adapters.indextts2_worker import get_indextts2_worker_client
from tts_api.audio import create_output_path, read_wav_metadata
from tts_api.config import Settings, get_settings
from tts_api.schemas import SpeechRequest, SpeechResult


class IndexTts2Worker(Protocol):
    def synthesize(self, request: SpeechRequest, output_path: Path, prompt_audio: str) -> Path:
        ...


class IndexTts2Adapter(TtsAdapter):
    def __init__(
        self,
        settings: Settings | None = None,
        python_executable: str | None = None,
        worker_client: IndexTts2Worker | None = None,
    ):
        self.settings = settings or get_settings()
        self.lazy_pack_root = self.settings.indextts2_root
        self.python_executable = python_executable or str(self.python_dir / "python.exe")
        self.worker_client = worker_client

    @property
    def python_dir(self) -> Path:
        return self.lazy_pack_root / "WPy64-310110" / "python-3.10.11.amd64"

    @property
    def ffmpeg_dir(self) -> Path:
        return self.lazy_pack_root / "ffmpeg"

    @property
    def source_dir(self) -> Path:
        return self.lazy_pack_root / "Index-TTS"

    @property
    def model_dir(self) -> Path:
        return self.source_dir / "checkpoints"

    @property
    def default_prompt_audio(self) -> Path:
        return self.source_dir / "examples" / "voice_01.wav"

    @property
    def runner_script(self) -> Path:
        return self.settings.workspace_root / "apps" / "api" / "tools" / "run_indextts2.py"

    def build_environment(self) -> dict[str, str]:
        environment = os.environ.copy()
        environment["HF_HOME"] = str(self.lazy_pack_root / "models")
        environment["XDG_CACHE_HOME"] = str(self.lazy_pack_root / "models")
        environment["HF_ENDPOINT"] = "https://hf-mirror.com"
        environment["HF_HUB_OFFLINE"] = "1"
        environment["TRANSFORMERS_OFFLINE"] = "1"
        environment["PYTHONIOENCODING"] = "utf-8"
        prepend_paths = [
            str(self.python_dir),
            str(self.python_dir / "Scripts"),
            str(self.ffmpeg_dir),
        ]
        environment["PATH"] = os.pathsep.join(prepend_paths + [environment.get("PATH", "")])
        return environment

    def build_command(self, request: SpeechRequest) -> tuple[list[str], Path]:
        output_path = create_output_path(self.settings.output_dir, ".wav")
        prompt_audio = request.reference_audio or str(self.default_prompt_audio)
        command = [
            self.python_executable,
            str(self.runner_script),
            "--source-dir",
            str(self.source_dir),
            "--model-dir",
            str(self.model_dir),
            "--config",
            str(self.model_dir / "config.yaml"),
            "--text",
            request.input,
            "--prompt-audio",
            prompt_audio,
            "--output",
            str(output_path),
            "--max-text-tokens-per-segment",
            "120",
            "--fp16",
        ]
        if request.emotion:
            command.extend(["--emotion-text", request.emotion])
        return command, output_path

    def synthesize(self, request: SpeechRequest) -> SpeechResult:
        _, output_path = self.build_command(request)
        prompt_audio = request.reference_audio or str(self.default_prompt_audio)
        worker_client = self.worker_client or get_indextts2_worker_client(self.settings)
        worker_client.synthesize(request, output_path, prompt_audio)
        if not output_path.exists():
            raise RuntimeError("IndexTTS2 completed but did not create an output file.")
        sample_rate, duration_seconds = read_wav_metadata(output_path)
        return SpeechResult(
            audio_url=f"/outputs/{output_path.name}",
            file_path=str(output_path),
            model=request.model,
            sample_rate=sample_rate,
            duration_seconds=duration_seconds,
        )
