import subprocess
from pathlib import Path

from tts_api.adapters.base import TtsAdapter
from tts_api.audio import create_output_path
from tts_api.config import Settings, get_settings
from tts_api.schemas import SpeechRequest, SpeechResult


class F5TtsAdapter(TtsAdapter):
    def __init__(self, settings: Settings | None = None, python_executable: str = "python"):
        self.settings = settings or get_settings()
        self.python_executable = python_executable

    def build_command(self, request: SpeechRequest) -> tuple[list[str], Path]:
        output_path = create_output_path(self.settings.output_dir, ".wav")
        command = [
            self.python_executable,
            "-m",
            "f5_tts.infer.infer_cli",
            "--gen_text",
            request.input,
            "--output_file",
            str(output_path),
        ]
        if request.reference_audio:
            command.extend(["--ref_audio", request.reference_audio])
        if request.reference_text:
            command.extend(["--ref_text", request.reference_text])
        return command, output_path

    def synthesize(self, request: SpeechRequest) -> SpeechResult:
        command, output_path = self.build_command(request)
        completed = subprocess.run(command, check=True, capture_output=True, text=True)
        if completed.returncode != 0:
            raise RuntimeError(completed.stderr)
        return SpeechResult(
            audio_url=f"/outputs/{output_path.name}",
            file_path=str(output_path),
            model=request.model,
            sample_rate=24000,
            duration_seconds=0.0,
        )
