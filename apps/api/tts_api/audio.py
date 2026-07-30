import math
import re
import wave
from datetime import datetime
from pathlib import Path
from uuid import uuid4


OUTPUT_TEXT_PREVIEW_LENGTH = 18
_INVALID_WINDOWS_FILE_CHARS = re.compile(r'[<>:"/\\|?*\x00-\x1f]')


def output_text_preview(text: str | None, max_length: int = OUTPUT_TEXT_PREVIEW_LENGTH) -> str:
    """Create a readable, Windows-safe filename prefix from generated text."""
    normalized = re.sub(r"\s+", "", text or "")
    normalized = _INVALID_WINDOWS_FILE_CHARS.sub("_", normalized).strip(" ._")
    return normalized[:max(1, max_length)] or "语音"


def create_output_path(output_dir: Path, suffix: str = ".wav", text: str | None = None) -> Path:
    output_dir.mkdir(parents=True, exist_ok=True)
    extension = suffix if suffix.startswith(".") else f".{suffix}"
    timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    return output_dir / f"{output_text_preview(text)}_{timestamp}_{uuid4().hex[:8]}{extension}"


def read_wav_metadata(path: Path) -> tuple[int, float]:
    with wave.open(str(path), "rb") as wav_file:
        sample_rate = wav_file.getframerate()
        frame_count = wav_file.getnframes()
    duration_seconds = frame_count / sample_rate if sample_rate else 0.0
    return sample_rate, duration_seconds


def write_sine_wav(path: Path, sample_rate: int = 24000, duration_seconds: float = 0.6) -> None:
    amplitude = 12000
    frequency = 440
    frame_count = int(sample_rate * duration_seconds)
    with wave.open(str(path), "wb") as wav_file:
        wav_file.setnchannels(1)
        wav_file.setsampwidth(2)
        wav_file.setframerate(sample_rate)
        for frame in range(frame_count):
            value = int(amplitude * math.sin(2 * math.pi * frequency * frame / sample_rate))
            wav_file.writeframesraw(value.to_bytes(2, byteorder="little", signed=True))
