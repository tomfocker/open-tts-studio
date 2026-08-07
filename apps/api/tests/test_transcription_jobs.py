import time
from pathlib import Path

from fastapi.testclient import TestClient

from tts_api import transcription
from tts_api.adapters.qwen_asr import TimestampedQwenTranscription
from tts_api.config import Settings, get_settings
from tts_api.main import create_app
from tts_api.schemas import TranscriptionBackend, TranscriptionJobRequest, TranscriptionOutputFormat


def _settings(tmp_path: Path) -> Settings:
    return Settings(
        output_dir=tmp_path / "outputs",
        tasks_file=tmp_path / "tasks.json",
        task_log_dir=tmp_path / "task-logs",
        transcription_jobs_file=tmp_path / "transcriptions.json",
        transcription_input_dir=tmp_path / "transcription-inputs",
    )


def _input(settings: Settings, suffix: str = ".mp4") -> str:
    input_id = "a" * 32
    settings.transcription_input_dir.mkdir(parents=True, exist_ok=True)
    (settings.transcription_input_dir / f"{input_id}{suffix}").write_bytes(b"managed-local-media")
    return input_id


def _wait(store: transcription.TranscriptionJobStore, job_id: str):
    for _ in range(200):
        job = store.get(job_id)
        if job and job.status.value in {"completed", "failed", "cancelled"}:
            return job
        time.sleep(0.01)
    raise AssertionError("timed out waiting for transcription job")


def test_qwen_srt_job_uses_real_monotonic_token_boundaries(tmp_path: Path, monkeypatch):
    settings = _settings(tmp_path)
    input_id = _input(settings)

    class FakeQwen:
        model_name = "qwen3-asr-1.7b"
        runtime_model_id = "qwen3-asr"

        def __init__(self, _settings):
            pass

        def transcribe_timestamped_path(self, _path, language="zh", on_process=None):
            return TimestampedQwenTranscription(
                text="你好，世界。",
                raw_text="你好，世界。",
                tokens=["你", "好", "，", "世", "界", "。"],
                timestamps=[0.0, 0.12, 0.24, 0.45, 0.62, 0.81],
                duration_seconds=1.0,
                language=language,
                model="qwen3-asr-1.7b+qwen3-forced-aligner-0.6b",
            )

    monkeypatch.setattr(transcription, "QwenASRTranscriber", FakeQwen)
    monkeypatch.setattr(transcription, "probe_audio_metadata", lambda _path, _ffmpeg: (16000, 1.0))
    monkeypatch.setattr(transcription, "release_conflicting_runtimes", lambda *_args: [])
    store = transcription.TranscriptionJobStore(settings.transcription_jobs_file)
    runner = transcription.TranscriptionRunner(store, settings)

    queued = runner.enqueue(
        TranscriptionJobRequest(
            input_id=input_id,
            source_file_name="真实视频.mp4",
            backend=TranscriptionBackend.qwen3,
            output_format=TranscriptionOutputFormat.srt,
            language="zh",
        )
    )
    completed = _wait(store, queued.id)

    assert completed.status.value == "completed"
    assert completed.duration_seconds == 1.0
    assert completed.tokens[-1].end_seconds == 1.0
    assert all(0 <= token.start_seconds < token.end_seconds <= 1.0 for token in completed.tokens)
    assert all(left.end_seconds <= right.start_seconds for left, right in zip(completed.tokens, completed.tokens[1:]))
    assert all(0 <= segment.start_seconds < segment.end_seconds <= 1.0 for segment in completed.segments)
    srt = transcription.generate_srt(completed)
    assert "00:00:00,000 --> 00:00:01,000" in srt
    assert "你好，世界。" in srt


def test_qwen_srt_uses_aligned_text_when_raw_chunk_merge_loses_a_repeated_tail(tmp_path: Path, monkeypatch):
    settings = _settings(tmp_path)
    input_id = _input(settings)

    class FakeQwen:
        model_name = "qwen3-asr-1.7b"
        runtime_model_id = "qwen3-asr"

        def __init__(self, _settings):
            pass

        def transcribe_timestamped_path(self, _path, language="zh", on_process=None):
            return TimestampedQwenTranscription(
                text="前段重复尾部",
                raw_text="前段重复",
                tokens=list("前段重复尾部"),
                timestamps=[0.0, 0.1, 0.2, 0.3, 0.4, 0.5],
                duration_seconds=0.6,
                language=language,
                model="qwen3-asr-1.7b+qwen3-forced-aligner-0.6b",
            )

    monkeypatch.setattr(transcription, "QwenASRTranscriber", FakeQwen)
    monkeypatch.setattr(transcription, "probe_audio_metadata", lambda _path, _ffmpeg: (16000, 0.6))
    monkeypatch.setattr(transcription, "release_conflicting_runtimes", lambda *_args: [])
    store = transcription.TranscriptionJobStore(settings.transcription_jobs_file)
    runner = transcription.TranscriptionRunner(store, settings)

    queued = runner.enqueue(
        TranscriptionJobRequest(
            input_id=input_id,
            source_file_name="重复尾句.mp4",
            backend=TranscriptionBackend.qwen3,
            output_format=TranscriptionOutputFormat.srt,
            language="zh",
        )
    )
    completed = _wait(store, queued.id)

    assert completed.status.value == "completed"
    assert completed.text == "前段重复尾部"


def test_srt_rejects_out_of_range_qwen_timestamp_instead_of_clamping(tmp_path: Path, monkeypatch):
    settings = _settings(tmp_path)
    input_id = _input(settings)

    class FakeQwen:
        runtime_model_id = "qwen3-asr"

        def __init__(self, _settings):
            pass

        def transcribe_timestamped_path(self, _path, language="zh", on_process=None):
            return TimestampedQwenTranscription(
                text="越界",
                raw_text="越界",
                tokens=["越", "界"],
                timestamps=[0.0, 3.0],
                duration_seconds=1.0,
                language=language,
                model="fake",
            )

    monkeypatch.setattr(transcription, "QwenASRTranscriber", FakeQwen)
    monkeypatch.setattr(transcription, "probe_audio_metadata", lambda _path, _ffmpeg: (16000, 1.0))
    monkeypatch.setattr(transcription, "release_conflicting_runtimes", lambda *_args: [])
    store = transcription.TranscriptionJobStore(settings.transcription_jobs_file)
    runner = transcription.TranscriptionRunner(store, settings)
    queued = runner.enqueue(
        TranscriptionJobRequest(
            input_id=input_id,
            source_file_name="media.mp4",
            backend="qwen3",
            output_format="srt",
        )
    )
    failed = _wait(store, queued.id)

    assert failed.status.value == "failed"
    assert "越界" in (failed.error or "")
    assert not failed.segments


def test_srt_preserves_worker_timestamp_warnings_without_fabricating_boundaries(tmp_path: Path, monkeypatch):
    settings = _settings(tmp_path)
    input_id = _input(settings)

    class FakeQwen:
        runtime_model_id = "qwen3-asr"

        def __init__(self, _settings):
            pass

        def transcribe_timestamped_path(self, _path, language="zh", on_process=None):
            return TimestampedQwenTranscription(
                text="真实边界",
                raw_text="真实边界",
                tokens=["真", "实", "边", "界"],
                timestamps=[0.0, 0.2, 0.5, 0.7],
                duration_seconds=1.0,
                language=language,
                model="fake",
                warnings=["timestamp_outside_audio_chunk_dropped:2"],
            )

    monkeypatch.setattr(transcription, "QwenASRTranscriber", FakeQwen)
    monkeypatch.setattr(transcription, "probe_audio_metadata", lambda _path, _ffmpeg: (16000, 1.0))
    monkeypatch.setattr(transcription, "release_conflicting_runtimes", lambda *_args: [])
    store = transcription.TranscriptionJobStore(settings.transcription_jobs_file)
    runner = transcription.TranscriptionRunner(store, settings)
    queued = runner.enqueue(
        TranscriptionJobRequest(input_id=input_id, source_file_name="media.mp4", backend="qwen3", output_format="srt")
    )
    completed = _wait(store, queued.id)

    assert completed.status.value == "completed"
    assert completed.warnings == ["timestamp_outside_audio_chunk_dropped:2"]
    assert all(0 <= token.start_seconds < token.end_seconds <= 1.0 for token in completed.tokens)


def test_text_job_allows_lightweight_asr_without_forcing_alignment(tmp_path: Path, monkeypatch):
    settings = _settings(tmp_path)
    input_id = _input(settings, ".wav")

    class FakeSenseVoice:
        model_name = "sensevoice-small"
        runtime_model_id = "sensevoice"

        def transcribe_path(self, _path, language="zh"):
            assert language == "zh"
            return "本地快速文本"

    monkeypatch.setattr(transcription, "get_local_transcriber", lambda _settings, backend=None: FakeSenseVoice())
    monkeypatch.setattr(transcription, "probe_audio_metadata", lambda _path, _ffmpeg: (16000, 0.8))
    monkeypatch.setattr(transcription, "release_conflicting_runtimes", lambda *_args: [])
    store = transcription.TranscriptionJobStore(settings.transcription_jobs_file)
    runner = transcription.TranscriptionRunner(store, settings)
    queued = runner.enqueue(
        TranscriptionJobRequest(input_id=input_id, source_file_name="sample.wav", backend="sensevoice", output_format="txt")
    )
    completed = _wait(store, queued.id)

    assert completed.status.value == "completed"
    assert completed.text == "本地快速文本"
    assert completed.segments == []


def test_persisted_transcription_job_never_contains_source_path_or_worker_error_path(tmp_path: Path, monkeypatch):
    settings = _settings(tmp_path)
    input_id = _input(settings, ".wav")
    private_path = r"D:\private\voiceprint\reference.wav"

    class FailingSenseVoice:
        model_name = "sensevoice-small"
        runtime_model_id = "sensevoice"

        def transcribe_path(self, _path, language="zh"):
            raise RuntimeError(private_path)

    monkeypatch.setattr(transcription, "get_local_transcriber", lambda _settings, backend=None: FailingSenseVoice())
    monkeypatch.setattr(transcription, "probe_audio_metadata", lambda _path, _ffmpeg: (16000, 0.8))
    monkeypatch.setattr(transcription, "release_conflicting_runtimes", lambda *_args: [])
    store = transcription.TranscriptionJobStore(settings.transcription_jobs_file)
    runner = transcription.TranscriptionRunner(store, settings)
    queued = runner.enqueue(
        TranscriptionJobRequest(input_id=input_id, source_file_name="private.wav", backend="sensevoice", output_format="txt")
    )
    failed = _wait(store, queued.id)
    persisted = settings.transcription_jobs_file.read_text(encoding="utf-8")

    assert failed.status.value == "failed"
    assert private_path not in persisted
    assert str(settings.transcription_input_dir) not in persisted
    assert "reference.wav" not in persisted


def test_upload_job_and_export_surface_use_opaque_input_id(tmp_path: Path, monkeypatch):
    class FakeSenseVoice:
        model_name = "sensevoice-small"
        runtime_model_id = "sensevoice"

        def transcribe_path(self, _path, language="zh"):
            return "接口文本"

    monkeypatch.setenv("OPEN_TTS_SETTINGS_FILE", str(tmp_path / "settings.json"))
    monkeypatch.setenv("OPEN_TTS_TASKS_FILE", str(tmp_path / "tasks.json"))
    monkeypatch.setenv("OPEN_TTS_OUTPUT_DIR", str(tmp_path / "outputs"))
    monkeypatch.setenv("OPEN_TTS_TRANSCRIPTION_JOBS_FILE", str(tmp_path / "transcriptions.json"))
    monkeypatch.setenv("OPEN_TTS_TRANSCRIPTION_INPUT_DIR", str(tmp_path / "inputs"))
    get_settings.cache_clear()
    transcription._stores.clear()
    transcription._runners.clear()
    monkeypatch.setattr(transcription, "get_local_transcriber", lambda _settings, backend=None: FakeSenseVoice())
    monkeypatch.setattr(transcription, "probe_audio_metadata", lambda _path, _ffmpeg: (16000, 0.5))
    monkeypatch.setattr(transcription, "release_conflicting_runtimes", lambda *_args: [])

    with TestClient(create_app()) as client:
        upload = client.post("/v1/transcriptions/uploads", files={"file": ("source.wav", b"local-media", "audio/wav")})
        assert upload.status_code == 200
        imported = upload.json()
        assert set(imported) == {"id", "file_name", "file_size_bytes"}
        assert "path" not in str(imported).lower()

        created = client.post(
            "/v1/transcriptions",
            json={"input_id": imported["id"], "source_file_name": imported["file_name"], "backend": "sensevoice", "output_format": "txt", "language": "zh"},
        )
        assert created.status_code == 200
        job_id = created.json()["id"]
        for _ in range(200):
            job = client.get(f"/v1/transcriptions/{job_id}").json()
            if job["status"] in {"completed", "failed"}:
                break
            time.sleep(0.01)
        assert job["status"] == "completed"
        assert client.get(f"/v1/transcriptions/{job_id}/export.txt").text == "接口文本"
        task = next(item for item in client.get("/v1/tasks").json()["tasks"] if item["id"] == f"transcription:{job_id}")
        assert task["source"] == "transcription"
        assert task["results"][0]["kind"] == "transcript"
        assert task["results"][0]["file_name"] == "source.txt"
        assert task["results"][0]["downloadable"] is True
