import math
import json
import re
import shutil
import subprocess
import wave
from datetime import datetime
from pathlib import Path


OUTPUT_TITLE_MAX_LENGTH = 48
_INVALID_WINDOWS_FILE_CHARS = re.compile(r'[<>:"/\\|?*\x00-\x1f]')


def output_title(text: str | None, max_length: int = OUTPUT_TITLE_MAX_LENGTH, first_sentence: bool = False) -> str:
    """Return the human-readable title used by a published output filename.

    The title is deliberately the only semantic part of the filename. Model,
    task type and settings belong to the task/asset metadata shown in the
    成果中心, while the timestamp keeps files sortable and the collision
    suffix below keeps repeated requests safe.
    """
    normalized = re.sub(r"\s+", " ", text or "")
    if first_sentence:
        sentence_end = re.search(r"[。！？!?；;]", normalized)
        if sentence_end:
            normalized = normalized[:sentence_end.start()]
    normalized = _INVALID_WINDOWS_FILE_CHARS.sub("_", normalized).strip(" ._")
    return normalized[:max(1, max_length)] or "未命名"


def create_output_path(
    output_dir: Path,
    suffix: str = ".wav",
    text: str | None = None,
    *,
    first_sentence: bool = False,
) -> Path:
    output_dir.mkdir(parents=True, exist_ok=True)
    extension = suffix if suffix.startswith(".") else f".{suffix}"
    timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    base_name = f"{timestamp}-{output_title(text, first_sentence=first_sentence)}"
    candidate = output_dir / f"{base_name}{extension}"
    if not candidate.exists():
        return candidate
    for sequence in range(2, 1000):
        candidate = output_dir / f"{base_name}-{sequence:02d}{extension}"
        if not candidate.exists():
            return candidate
    raise RuntimeError("无法为产出文件选择可用文件名。")


def read_wav_metadata(path: Path) -> tuple[int, float]:
    with wave.open(str(path), "rb") as wav_file:
        sample_rate = wav_file.getframerate()
        frame_count = wav_file.getnframes()
    duration_seconds = frame_count / sample_rate if sample_rate else 0.0
    return sample_rate, duration_seconds


def _ffprobe_path_from_ffmpeg(ffmpeg_path: str) -> str:
    candidate = Path(ffmpeg_path)
    if candidate.name.lower().startswith("ffprobe"):
        return str(candidate)
    if candidate.name.lower().startswith("ffmpeg"):
        sibling = candidate.with_name("ffprobe.exe" if candidate.suffix.lower() == ".exe" else "ffprobe")
        if sibling.is_file():
            return str(sibling)
    return shutil.which("ffprobe") or "ffprobe"


def _probe_with_ffprobe(path: Path, ffmpeg_path: str) -> tuple[int, float]:
    """Read the duration from the final encoded audio file.

    ``ffprobe`` is preferred, but bundled desktop ffmpeg distributions often
    omit it. A decoded 16 kHz PCM frame count remains a real-file measurement
    and is therefore a safe fallback for alignment bounds.
    """
    ffprobe_path = _ffprobe_path_from_ffmpeg(ffmpeg_path)
    try:
        completed = subprocess.run(
            [
                ffprobe_path,
                "-v",
                "error",
                "-show_entries",
                "format=duration:stream=sample_rate",
                "-of",
                "json",
                str(path),
            ],
            check=True,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
        )
        payload = json.loads(completed.stdout)
        streams = payload.get("streams") if isinstance(payload, dict) else []
        stream = streams[0] if isinstance(streams, list) and streams else {}
        sample_rate = int(stream.get("sample_rate") or 0)
        duration = float((payload.get("format") or {}).get("duration") or 0)
        if sample_rate > 0 and duration > 0:
            return sample_rate, duration
    except (OSError, subprocess.SubprocessError, ValueError, json.JSONDecodeError):
        pass

    completed = subprocess.run(
        [ffmpeg_path, "-nostdin", "-v", "error", "-i", str(path), "-f", "f32le", "-ac", "1", "-ar", "16000", "-"],
        check=False,
        capture_output=True,
    )
    frame_count = len(completed.stdout) // 4
    if completed.returncode != 0 or frame_count <= 0:
        raise RuntimeError("无法从最终音频文件探测有效的采样率或时长。")
    return 16000, frame_count / 16000


def probe_audio_metadata(path: Path, ffmpeg_path: str = "ffmpeg") -> tuple[int, float]:
    """Measure the final audio file rather than trusting an adapter estimate."""

    if not path.is_file():
        raise FileNotFoundError(f"生成后的音频文件不存在：{path}")
    if path.suffix.lower() == ".wav":
        try:
            return read_wav_metadata(path)
        except wave.Error:
            # Python's wave module rejects IEEE-float WAVs emitted by several
            # local TTS servers; ffprobe/ffmpeg still measures their real data.
            pass
    return _probe_with_ffprobe(path, ffmpeg_path)


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
