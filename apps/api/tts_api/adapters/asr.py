"""Selection of the independently configured local ASR backend."""

from __future__ import annotations

from typing import Protocol

from tts_api.adapters.qwen_asr import QwenASRTranscriber
from tts_api.adapters.sensevoice import SenseVoiceTranscriber
from tts_api.config import Settings


class LocalTranscriber(Protocol):
    model_name: str
    runtime_model_id: str

    def transcribe_path(self, audio_path, language: str = "zh") -> str: ...

    def transcribe_upload(self, stream, filename: str, language: str = "zh") -> str: ...


def get_local_transcriber(settings: Settings, backend: str | None = None) -> LocalTranscriber:
    """Resolve an ASR engine without mutating the user's global ASR setting."""

    active_backend = backend or settings.asr_backend
    if active_backend == "qwen3":
        return QwenASRTranscriber(settings)
    return SenseVoiceTranscriber(settings)
