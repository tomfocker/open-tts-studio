import importlib.util
from pathlib import Path

import pytest


WORKER_PATH = Path(__file__).resolve().parents[1] / "tools" / "run_qwen_timestamped_asr.py"
SPEC = importlib.util.spec_from_file_location("qwen_timestamp_worker", WORKER_PATH)
assert SPEC and SPEC.loader
worker = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(worker)


def test_timestamp_worker_drops_padded_positions_instead_of_clamping_them():
    tokens, timestamps, dropped = worker._valid_timestamp_pairs(
        ["在", "真", "实", "音", "频", "外"],
        [0.0, 0.2, 1.0, 1.5, 1.51, float("nan")],
        1.5,
    )

    assert tokens == ["在", "真", "实", "音"]
    assert timestamps == [0.0, 0.2, 1.0, 1.5]
    assert dropped == 2


def test_timestamp_worker_falls_back_to_the_measured_monotonic_suffix():
    def ambiguous_merge(**_kwargs):
        return ["甲", "乙", "丙"], [58.0, 61.0, 60.0]

    tokens, timestamps, used_fallback = worker._merge_monotonic_chunk(
        ambiguous_merge,
        ["甲"],
        [58.0],
        ["乙", "丙"],
        [5.0, 6.0],
        55.0,
        5.0,
        False,
    )

    assert used_fallback is True
    assert tokens == ["甲", "乙", "丙"]
    assert timestamps == [58.0, 60.0, 61.0]


def test_timestamp_worker_keeps_the_non_overlapping_tail_when_text_merge_is_ambiguous():
    def greedy_text_merge(**kwargs):
        return kwargs["prev_tokens"], kwargs["prev_timestamps"]

    tokens, timestamps, used_fallback = worker._merge_monotonic_chunk(
        greedy_text_merge,
        ["重"],
        [114.76],
        ["叠", "尾", "部"],
        [4.8, 5.2, 22.08],
        110.0,
        5.0,
        False,
    )

    assert used_fallback is True
    assert tokens == ["重", "尾", "部"]
    assert timestamps == pytest.approx([114.76, 115.2, 132.08])
