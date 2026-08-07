import json
import struct
from pathlib import Path
from types import SimpleNamespace

from tts_api import audio


def write_float_wav(path: Path, sample_rate: int = 48000, duration_seconds: float = 1.0) -> None:
    frame_count = int(sample_rate * duration_seconds)
    samples = b"".join(struct.pack("<f", 0.2) for _ in range(frame_count))
    fmt_chunk = struct.pack("<HHIIHH", 3, 1, sample_rate, sample_rate * 4, 4, 32)
    payload = b"WAVE" + b"fmt " + struct.pack("<I", len(fmt_chunk)) + fmt_chunk + b"data" + struct.pack("<I", len(samples)) + samples
    path.write_bytes(b"RIFF" + struct.pack("<I", len(payload)) + payload)


def test_probe_uses_real_file_fallback_for_float_wav(tmp_path: Path, monkeypatch):
    path = tmp_path / "float.wav"
    write_float_wav(path)
    calls: list[list[str]] = []

    def fake_run(command, **_kwargs):
        calls.append(command)
        return SimpleNamespace(
            returncode=0,
            stdout=json.dumps({"format": {"duration": "1.0"}, "streams": [{"sample_rate": "48000"}]}),
        )

    monkeypatch.setattr(audio.subprocess, "run", fake_run)

    sample_rate, duration = audio.probe_audio_metadata(path)

    assert (sample_rate, duration) == (48000, 1.0)
    assert calls


def test_create_output_path_uses_timestamp_and_first_sentence(tmp_path: Path, monkeypatch):
    class FixedDateTime:
        @classmethod
        def now(cls):
            from datetime import datetime

            return datetime(2026, 8, 8, 15, 30, 12)

    monkeypatch.setattr(audio, "datetime", FixedDateTime)

    output = audio.create_output_path(
        tmp_path,
        ".wav",
        '这是第一句。这里是第二句，不能进入文件名。<非法字符>',
        first_sentence=True,
    )

    assert output.name == "20260808-153012-这是第一句.wav"


def test_create_output_path_adds_short_sequence_only_on_collision(tmp_path: Path, monkeypatch):
    class FixedDateTime:
        @classmethod
        def now(cls):
            from datetime import datetime

            return datetime(2026, 8, 8, 15, 30, 12)

    monkeypatch.setattr(audio, "datetime", FixedDateTime)
    first = audio.create_output_path(tmp_path, ".wav", "同一段文本")
    first.touch()
    second = audio.create_output_path(tmp_path, ".wav", "同一段文本")

    assert first.name == "20260808-153012-同一段文本.wav"
    assert second.name == "20260808-153012-同一段文本-02.wav"
