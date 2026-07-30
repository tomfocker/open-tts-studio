import json
import sys
import time
from pathlib import Path

from fastapi.testclient import TestClient

from tts_api import alignment
from tts_api.audio import write_sine_wav
from tts_api.config import Settings, get_settings
from tts_api.main import create_app
from tts_api.schemas import SpeechRequest, SpeechResult


def _settings(tmp_path: Path) -> Settings:
    return Settings(
        output_dir=tmp_path / "outputs",
        tasks_file=tmp_path / "tasks.json",
        task_log_dir=tmp_path / "task-logs",
        alignment_jobs_file=tmp_path / "alignments.json",
        alignment_cache_dir=tmp_path / "alignment-cache",
        alignment_work_dir=tmp_path / "alignment-work",
    )


def _result(tmp_path: Path, text: str = "你好世界") -> SpeechResult:
    audio = tmp_path / "final.wav"
    write_sine_wav(audio, sample_rate=24000, duration_seconds=0.6)
    return SpeechResult(
        audio_url="/outputs/final.wav",
        file_path=str(audio),
        model="mock-tts",
        sample_rate=123,  # Deliberately wrong: alignment must probe the file.
        duration_seconds=0.0,
    )


def _request(text: str, wait: bool = True) -> SpeechRequest:
    return SpeechRequest(
        model="mock-tts",
        input=text,
        alignment={"enabled": True, "language": "zh", "granularity": "token", "wait_for_result": wait},
    )


def _stub_alignment_runtime(monkeypatch) -> None:
    """Keep alignment unit tests isolated from GPU/process lifecycle."""

    monkeypatch.setattr(alignment, "release_idle_runtimes_for_alignment", lambda _settings: [])


def _worker_result(work: alignment.AlignmentWork, *, token_end: float | None = None, confidence: float = 0.99) -> dict:
    duration = work.duration_seconds
    tokens = []
    characters = [item for item in work.transcript if not item.isspace() and item not in "，。！？；、,.!?;"]
    for index, char in enumerate(characters):
        start = index / len(characters) * duration
        end = (index + 1) / len(characters) * duration
        tokens.append(
            {
                "text": char,
                "char_start": index,
                "char_end": index + 1,
                "start_seconds": start,
                "end_seconds": token_end if index == len(characters) - 1 and token_end is not None else end,
                "confidence": confidence,
            }
        )
    return {
        "version": 1,
        "language": "zh",
        "audio_sha256": work.audio_sha256,
        "transcript_sha256": work.transcript_sha256,
        "model_version": "test-ctc-v1",
        "duration_seconds": duration,
        "segments": [
            {
                "id": "seg_001",
                "text": work.transcript,
                "char_start": 0,
                "char_end": len(work.transcript),
                "start_seconds": 0,
                "end_seconds": tokens[-1]["end_seconds"],
                "confidence": confidence,
            }
        ],
        "tokens": tokens,
        "warnings": ["low_confidence_tokens: test"] if confidence < 0.55 else [],
    }


def test_legacy_speech_response_does_not_add_alignment_fields(tmp_path: Path, monkeypatch):
    monkeypatch.setenv("OPEN_TTS_SETTINGS_FILE", str(tmp_path / "settings.json"))
    monkeypatch.setenv("OPEN_TTS_TASKS_FILE", str(tmp_path / "tasks.json"))
    monkeypatch.setenv("OPEN_TTS_OUTPUT_DIR", str(tmp_path / "outputs"))
    get_settings.cache_clear()
    client = TestClient(create_app())

    response = client.post("/v1/audio/speech", json={"model": "mock-tts", "input": "旧调用"})

    assert response.status_code == 200
    assert set(response.json()) == {"audio_url", "file_path", "model", "sample_rate", "duration_seconds"}


def test_chinese_alignment_returns_monotonic_char_tokens_and_probed_duration(tmp_path: Path, monkeypatch):
    settings = _settings(tmp_path)
    result = _result(tmp_path, "你好世界")
    _stub_alignment_runtime(monkeypatch)
    monkeypatch.setattr(alignment, "run_alignment_worker", lambda _settings, work, _job_id, _processes: _worker_result(work))

    completed, job = alignment.schedule_alignment(_request("你好世界"), result, None, settings=settings)

    assert job is not None
    assert completed.alignment_status == "completed"
    assert completed.duration_seconds == 0.6
    assert completed.sample_rate == 24000
    assert [item.text for item in completed.alignment.tokens] == list("你好世界")
    assert [(item.char_start, item.char_end) for item in completed.alignment.tokens] == [(0, 1), (1, 2), (2, 3), (3, 4)]
    assert all(0 <= item.start_seconds <= item.end_seconds <= completed.duration_seconds for item in completed.alignment.tokens)
    assert all(
        left.end_seconds <= right.start_seconds
        for left, right in zip(completed.alignment.tokens, completed.alignment.tokens[1:])
    )


def test_out_of_range_worker_timestamps_fail_instead_of_being_clamped(tmp_path: Path, monkeypatch):
    settings = _settings(tmp_path)
    result = _result(tmp_path, "中文")
    _stub_alignment_runtime(monkeypatch)
    monkeypatch.setattr(
        alignment,
        "run_alignment_worker",
        lambda _settings, work, _job_id, _processes: _worker_result(work, token_end=work.duration_seconds + 1),
    )

    completed, job = alignment.schedule_alignment(_request("中文"), result, None, settings=settings)

    assert job is not None
    assert completed.alignment_status == "failed"
    assert completed.alignment is None
    assert "超出最终音频时长" in (job.error or "")


def test_low_confidence_is_returned_as_warning_not_silent_success(tmp_path: Path, monkeypatch):
    settings = _settings(tmp_path)
    result = _result(tmp_path, "中文")
    _stub_alignment_runtime(monkeypatch)
    monkeypatch.setattr(
        alignment,
        "run_alignment_worker",
        lambda _settings, work, _job_id, _processes: _worker_result(work, confidence=0.31),
    )

    completed, _job = alignment.schedule_alignment(_request("中文"), result, None, settings=settings)

    assert completed.alignment_status == "completed"
    assert completed.alignment.warnings == ["low_confidence_tokens: test"]


def test_identical_audio_text_and_model_version_hits_local_cache(tmp_path: Path, monkeypatch):
    settings = _settings(tmp_path)
    result = _result(tmp_path, "缓存命中")
    calls = 0
    _stub_alignment_runtime(monkeypatch)

    def worker(_settings, work, _job_id, _processes):
        nonlocal calls
        calls += 1
        return _worker_result(work)

    monkeypatch.setattr(alignment, "run_alignment_worker", worker)
    first, first_job = alignment.schedule_alignment(_request("缓存命中"), result, None, settings=settings)
    second, second_job = alignment.schedule_alignment(_request("缓存命中"), result, None, settings=settings)

    assert first.alignment_status == "completed"
    assert second.alignment_status == "completed"
    assert first_job is not None and second_job is not None and first_job.id != second_job.id
    assert calls == 1


def test_final_alignment_goes_directly_to_forced_aligner(tmp_path: Path, monkeypatch):
    settings = _settings(tmp_path)
    result = _result(tmp_path, "校验文本")
    captured: dict = {}
    _stub_alignment_runtime(monkeypatch)

    def worker(_settings, work, _job_id, _processes):
        captured["work"] = work
        return _worker_result(work)

    monkeypatch.setattr(alignment, "run_alignment_worker", worker)
    completed, _job = alignment.schedule_alignment(_request("校验文本"), result, None, settings=settings)

    assert completed.alignment_status == "completed"
    assert captured["work"].transcript == "校验文本"


def test_worker_discards_native_model_output_to_prevent_pipe_deadlock(tmp_path: Path, monkeypatch):
    settings = _settings(tmp_path).model_copy(
        update={
            "alignment_python": Path(sys.executable),
            "alignment_capswriter_root": tmp_path,
            "alignment_aligner_model_dir": tmp_path,
        }
    )
    work = alignment._work_from_result(_request("防止日志管道死锁"), _result(tmp_path, "防止日志管道死锁"), settings, None)
    captured: dict = {}

    class FakeProcess:
        returncode = 0

        def poll(self):
            return 0

        def wait(self):
            return 0

    def fake_popen(command, **kwargs):
        captured.update(kwargs)
        response_path = Path(command[-1])
        response_path.write_text(json.dumps({"ok": True, "alignment": _worker_result(work)}), encoding="utf-8")
        return FakeProcess()

    monkeypatch.setattr(alignment.subprocess, "Popen", fake_popen)

    output = alignment.run_alignment_worker(settings, work, "deadlock-regression", {})

    assert output["tokens"]
    assert captured["stdout"] is alignment.subprocess.DEVNULL
    assert captured["stderr"] is alignment.subprocess.DEVNULL


def test_persisted_alignment_task_and_result_never_include_reference_material(tmp_path: Path, monkeypatch):
    settings = _settings(tmp_path)
    result = _result(tmp_path, "安全对齐")
    request = _request("安全对齐")
    # Bypass adapter capability validation to exercise the alignment persistence
    # boundary directly with data which must never be recorded here.
    request.reference_audio = r"D:\private\voiceprint.wav"
    request.reference_text = "绝不写入对齐任务"
    _stub_alignment_runtime(monkeypatch)
    monkeypatch.setattr(alignment, "run_alignment_worker", lambda _settings, work, _job_id, _processes: _worker_result(work))

    completed, job = alignment.schedule_alignment(request, result, None, settings=settings)
    stored = (settings.alignment_jobs_file).read_text(encoding="utf-8")
    cache = next(settings.alignment_cache_dir.glob("*.json")).read_text(encoding="utf-8")

    assert job is not None and completed.alignment is not None
    assert "voiceprint.wav" not in stored
    assert "绝不写入对齐任务" not in stored
    assert "voiceprint.wav" not in cache
    assert "绝不写入对齐任务" not in cache
    assert "reference_audio" not in json.dumps(job.model_dump(mode="json"), ensure_ascii=False)
    assert "reference_text" not in json.dumps(job.model_dump(mode="json"), ensure_ascii=False)
