import math
import wave
from pathlib import Path
from uuid import uuid4


def create_output_path(output_dir: Path, suffix: str = ".wav") -> Path:
    output_dir.mkdir(parents=True, exist_ok=True)
    return output_dir / f"{uuid4().hex}{suffix}"


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
