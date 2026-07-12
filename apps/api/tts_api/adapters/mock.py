from pathlib import Path

from tts_api.adapters.base import TtsAdapter
from tts_api.audio import create_output_path, write_sine_wav
from tts_api.config import Settings, get_settings
from tts_api.schemas import SpeechRequest, SpeechResult


class MockTtsAdapter(TtsAdapter):
    def __init__(self, settings: Settings | None = None):
        self.settings = settings or get_settings()

    def synthesize(self, request: SpeechRequest) -> SpeechResult:
        output_path = create_output_path(self.settings.output_dir, ".wav")
        write_sine_wav(output_path, sample_rate=24000, duration_seconds=0.6)
        return SpeechResult(
            audio_url=f"/outputs/{Path(output_path).name}",
            file_path=str(output_path),
            model=request.model,
            sample_rate=24000,
            duration_seconds=0.6,
        )
