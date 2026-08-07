from __future__ import annotations

import io

import numpy as np

from tools import sensevoice_asr_server


class _FakeProcess:
    def __init__(self, payload: bytes):
        self.stdout = io.BytesIO(payload)
        self.stderr = io.BytesIO()
        self._returncode: int | None = None

    def poll(self):
        return self._returncode

    def wait(self, timeout=None):
        self._returncode = 0
        return self._returncode

    def terminate(self):
        self._returncode = 0


def test_iter_audio_chunks_keeps_the_tail_and_overlap(monkeypatch):
    samples = np.arange(int(61.0 * sensevoice_asr_server.SAMPLE_RATE), dtype=np.float32)
    process = _FakeProcess(samples.tobytes())
    monkeypatch.setattr(sensevoice_asr_server.subprocess, "Popen", lambda *args, **kwargs: process)

    chunks = list(sensevoice_asr_server._iter_audio_chunks("input.mp4", "ffmpeg"))

    assert [len(chunk) for chunk in chunks] == [480_000, 480_000, 64_000]
    assert chunks[1][0] == samples[480_000 - 24_000]
    assert chunks[-1][-1] == samples[-1]


def test_merge_chunk_text_removes_only_exact_boundary_overlap():
    assert sensevoice_asr_server._merge_chunk_text("前面一句", "一句后面", "zh") == "前面一句后面"
    assert sensevoice_asr_server._merge_chunk_text("然后", "然后继续", "zh") == "然后继续"
    assert sensevoice_asr_server._merge_chunk_text("hello", "world", "en") == "hello world"


def test_transcribe_media_merges_the_final_window(monkeypatch):
    windows = [np.zeros(10, dtype=np.float32), np.ones(10, dtype=np.float32)]
    monkeypatch.setattr(sensevoice_asr_server, "_iter_audio_chunks", lambda *_args, **_kwargs: iter(windows))

    class FakeModel:
        def __init__(self):
            self.calls = []

        def generate(self, **kwargs):
            self.calls.append(kwargs)
            return [{"text": "|>前段重复" if kwargs["input"][0] == 0 else "|>重复尾段"}]

    model = FakeModel()
    assert sensevoice_asr_server._transcribe_media(model, "input.wav", "zh", True, "ffmpeg") == "前段重复尾段"
    assert [call["batch_size_s"] for call in model.calls] == [30, 30]
    assert all(call["fs"] == sensevoice_asr_server.SAMPLE_RATE for call in model.calls)
