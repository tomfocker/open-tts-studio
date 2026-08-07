from __future__ import annotations

import numpy as np

from tools import run_qwen_asr


def test_iter_audio_chunks_keeps_final_samples_and_overlap():
    samples = np.arange(int(121.0 * run_qwen_asr.SAMPLE_RATE), dtype=np.float32)

    chunks = list(run_qwen_asr._iter_audio_chunks(samples))

    assert [len(chunk) for chunk in chunks] == [960_000, 960_000, 176_000]
    assert chunks[1][0] == samples[55 * run_qwen_asr.SAMPLE_RATE]
    assert chunks[-1][-1] == samples[-1]


def test_merge_chunk_text_removes_only_exact_boundary_overlap():
    assert run_qwen_asr._merge_chunk_text("前面一句", "一句后面", "zh") == "前面一句后面"
    assert run_qwen_asr._merge_chunk_text("hello", "world", "en") == "hello world"
