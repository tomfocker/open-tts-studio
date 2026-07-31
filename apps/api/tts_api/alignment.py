"""Local, post-synthesis Qwen forced-alignment task queue.

The FastAPI process intentionally does not load an ASR model.  The final audio
and its formal TTS text go directly to a locally installed
Qwen3-ForcedAligner runtime; no pre-alignment transcription is performed.
Audio and text are written only to a short-lived local request file for the
child process; the persistent public task record contains hashes and output
metadata, never voice-reference data.
"""

from __future__ import annotations

import hashlib
import json
import os
import queue
import subprocess
import sys
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Callable
from uuid import uuid4

from tts_api.audio import probe_audio_metadata
from tts_api.config import Settings, get_settings
from tts_api.qwen_runtime import QwenRuntimeError, qwen_worker_environment, resolve_qwen_runtime
from tts_api.runtime_memory import local_gpu_generation_lock
from tts_api.runtime_memory import release_idle_runtimes_for_alignment
from tts_api.schemas import (
    AlignmentJobInfo,
    AlignmentJobStatus,
    AlignmentRequest,
    AlignmentResult,
    AlignmentStatus,
    SpeechRequest,
    SpeechResult,
    utc_now,
)


MAX_STORED_ALIGNMENT_JOBS = 500
ALIGNMENT_WORKER = Path(__file__).resolve().parents[1] / "tools" / "run_qwen_forced_alignment.py"


class AlignmentError(RuntimeError):
    """A controlled error that is safe to expose in an alignment status."""


class AlignmentWorkerError(AlignmentError):
    pass


@dataclass(frozen=True)
class AlignmentWork:
    audio_path: Path
    audio_url: str
    transcript: str
    language: str
    granularity: AlignmentRequest
    duration_seconds: float
    sample_rate: int
    audio_sha256: str
    transcript_sha256: str
    cache_key: str
    speech_job_id: str | None


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _sha256_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _cache_key(audio_sha256: str, transcript_sha256: str, model_version: str) -> str:
    return hashlib.sha256(f"{audio_sha256}:{transcript_sha256}:{model_version}".encode("utf-8")).hexdigest()


def _external_status(status: AlignmentJobStatus) -> AlignmentStatus:
    if status in {AlignmentJobStatus.queued, AlignmentJobStatus.running}:
        return AlignmentStatus.pending
    return AlignmentStatus(status.value)


def _alignment_url(job_id: str) -> str:
    return f"/v1/tts/alignments/{job_id}"


def alignment_fields(job: AlignmentJobInfo) -> dict:
    """The only alignment fields copied into a public SpeechResult."""

    return {
        "alignment_status": _external_status(job.status),
        "alignment_url": job.alignment_url,
        "alignment": job.alignment if job.status == AlignmentJobStatus.completed else None,
    }


def with_alignment(result: SpeechResult, job: AlignmentJobInfo) -> SpeechResult:
    return result.model_copy(update=alignment_fields(job))


class AlignmentJobStore:
    def __init__(self, jobs_file: Path):
        self.jobs_file = jobs_file
        self._lock = threading.RLock()

    def list(self, limit: int = 100) -> list[AlignmentJobInfo]:
        with self._lock:
            return sorted(self._load().values(), key=lambda item: item.created_at, reverse=True)[:limit]

    def get(self, job_id: str) -> AlignmentJobInfo | None:
        with self._lock:
            return self._load().get(job_id)

    def create(self, work: AlignmentWork, settings: Settings, retry_of: str | None = None) -> AlignmentJobInfo:
        with self._lock:
            job_id = uuid4().hex
            job = AlignmentJobInfo(
                id=job_id,
                status=AlignmentJobStatus.queued,
                speech_job_id=work.speech_job_id,
                audio_url=work.audio_url,
                duration_seconds=work.duration_seconds,
                language=work.language,
                granularity=work.granularity.granularity,
                audio_sha256=work.audio_sha256,
                transcript_sha256=work.transcript_sha256,
                model_version=settings.alignment_model_version,
                cache_key=work.cache_key,
                alignment_url=_alignment_url(job_id),
                retry_of=retry_of,
            )
            return self._save_job(job)

    def mark_running(self, job_id: str) -> AlignmentJobInfo:
        with self._lock:
            job = self._require(job_id)
            if job.status == AlignmentJobStatus.cancelled:
                return job
            return self._save_job(job.model_copy(update={"status": AlignmentJobStatus.running, "started_at": utc_now(), "error": None}))

    def mark_completed(self, job_id: str, result: AlignmentResult) -> AlignmentJobInfo:
        with self._lock:
            job = self._require(job_id)
            if job.status == AlignmentJobStatus.cancelled:
                return job
            return self._save_job(
                job.model_copy(
                    update={
                        "status": AlignmentJobStatus.completed,
                        "alignment": result,
                        "error": None,
                        "completed_at": utc_now(),
                    }
                )
            )

    def mark_failed(self, job_id: str, error: str) -> AlignmentJobInfo:
        with self._lock:
            job = self._require(job_id)
            if job.status == AlignmentJobStatus.cancelled:
                return job
            return self._save_job(
                job.model_copy(
                    update={
                        "status": AlignmentJobStatus.failed,
                        "error": _safe_error(error),
                        "completed_at": utc_now(),
                    }
                )
            )

    def cancel(self, job_id: str, force_running: bool = False) -> AlignmentJobInfo:
        with self._lock:
            job = self._require(job_id)
            if job.status == AlignmentJobStatus.cancelled:
                return job
            if job.status == AlignmentJobStatus.running and not force_running:
                raise RuntimeError("对齐任务正在运行；请使用 force=true 终止本地对齐进程。")
            if job.status not in {AlignmentJobStatus.queued, AlignmentJobStatus.running}:
                raise RuntimeError("仅排队或运行中的对齐任务可以取消。")
            return self._save_job(
                job.model_copy(
                    update={
                        "status": AlignmentJobStatus.cancelled,
                        "error": "用户取消了本地对齐任务。",
                        "completed_at": utc_now(),
                    }
                )
            )

    def recover_after_restart(self) -> None:
        """Worker inputs are intentionally non-persistent, so mark in-flight work retryable."""

        with self._lock:
            jobs = self._load()
            changed = False
            for job_id, job in list(jobs.items()):
                if job.status not in {AlignmentJobStatus.queued, AlignmentJobStatus.running}:
                    continue
                jobs[job_id] = job.model_copy(
                    update={
                        "status": AlignmentJobStatus.failed,
                        "error": "本地服务已重启；对齐临时输入已清除，请重试该对齐任务。",
                        "completed_at": utc_now(),
                    }
                )
                changed = True
            if changed:
                self._save(jobs)

    def _require(self, job_id: str) -> AlignmentJobInfo:
        job = self._load().get(job_id)
        if job is None:
            raise KeyError(job_id)
        return job

    def _save_job(self, job: AlignmentJobInfo) -> AlignmentJobInfo:
        jobs = self._load()
        jobs[job.id] = job
        self._save(jobs)
        return job

    def _load(self) -> dict[str, AlignmentJobInfo]:
        if not self.jobs_file.exists():
            return {}
        try:
            raw = json.loads(self.jobs_file.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return {}
        items = raw.get("alignments", []) if isinstance(raw, dict) else []
        jobs: dict[str, AlignmentJobInfo] = {}
        for item in items:
            try:
                job = AlignmentJobInfo.model_validate(item)
            except Exception:
                continue
            jobs[job.id] = job
        return jobs

    def _save(self, jobs: dict[str, AlignmentJobInfo]) -> None:
        recent = sorted(jobs.values(), key=lambda item: item.created_at, reverse=True)[:MAX_STORED_ALIGNMENT_JOBS]
        self.jobs_file.parent.mkdir(parents=True, exist_ok=True)
        temporary = self.jobs_file.with_suffix(".tmp")
        temporary.write_text(
            json.dumps({"alignments": [job.model_dump(mode="json") for job in recent]}, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        temporary.replace(self.jobs_file)


def _safe_error(error: str) -> str:
    """Avoid putting command lines / temporary requests into a task record."""

    message = str(error).replace("\r", " ").replace("\n", " ").strip()
    return message[:1000] or "本地对齐失败。"


def validate_alignment_result(result: AlignmentResult, transcript: str, duration_seconds: float) -> None:
    """Reject, rather than clamp, worker output that cannot be a real timeline."""

    tolerance = 1e-6
    if abs(result.duration_seconds - duration_seconds) > 0.05:
        raise AlignmentWorkerError("对齐结果的音频时长与最终音频探测值不一致。")
    for name, entries in (("segments", result.segments), ("tokens", result.tokens), ("words", result.words or [])):
        previous_end = 0.0
        for entry in entries:
            if entry.char_end < entry.char_start or entry.char_end > len(transcript):
                raise AlignmentWorkerError(f"对齐结果包含越界的 {name} 字符索引。")
            if entry.start_seconds + tolerance < previous_end or entry.end_seconds + tolerance < entry.start_seconds:
                raise AlignmentWorkerError(f"对齐结果包含非单调的 {name} 时间戳。")
            if entry.start_seconds < -tolerance or entry.end_seconds > duration_seconds + tolerance:
                raise AlignmentWorkerError(f"对齐结果包含超出最终音频时长的 {name} 时间戳。")
            previous_end = entry.end_seconds


class AlignmentRunner:
    """A serial low-priority local worker for post-TTS Qwen alignment."""

    def __init__(self, store: AlignmentJobStore, settings: Settings):
        self.store = store
        self.settings = settings
        self._queue: queue.Queue[str] = queue.Queue()
        self._work: dict[str, AlignmentWork] = {}
        self._callbacks: dict[str, Callable[[AlignmentJobInfo], None]] = {}
        self._processes: dict[str, subprocess.Popen[str]] = {}
        self._lock = threading.RLock()
        self._worker: threading.Thread | None = None
        self.store.recover_after_restart()

    def enqueue(self, work: AlignmentWork, on_update: Callable[[AlignmentJobInfo], None] | None = None, retry_of: str | None = None) -> AlignmentJobInfo:
        job = self.store.create(work, self.settings, retry_of=retry_of)
        if on_update:
            self._callbacks[job.id] = on_update
        cached = self._load_cache(work.cache_key)
        if cached is not None:
            completed = self.store.mark_completed(job.id, cached)
            self._notify(completed)
            return completed
        with self._lock:
            self._work[job.id] = work
            self._queue.put(job.id)
            self._start_worker_if_needed()
        # A cache-less CPU job can finish before this method returns in tests
        # or for very short audio.  Return the freshest persisted state.
        return self.store.get(job.id) or job

    def cancel(self, job_id: str, force_running: bool = False) -> AlignmentJobInfo:
        job = self.store.cancel(job_id, force_running=force_running)
        if force_running:
            with self._lock:
                process = self._processes.get(job_id)
                if process and process.poll() is None:
                    process.terminate()
        self._notify(job)
        return job

    def retry(self, job_id: str) -> AlignmentJobInfo:
        previous = self.store.get(job_id)
        if previous is None:
            raise KeyError(job_id)
        if previous.status not in {AlignmentJobStatus.failed, AlignmentJobStatus.cancelled}:
            raise RuntimeError("仅失败或已取消的对齐任务可以重试。")
        work = _work_from_speech_job(previous, self.settings)
        return self.enqueue(work, on_update=_parent_speech_callback(previous.speech_job_id), retry_of=previous.id)

    def _start_worker_if_needed(self) -> None:
        if self._worker is None or not self._worker.is_alive():
            self._worker = threading.Thread(target=self._drain, name="open-tts-alignment-runner", daemon=True)
            self._worker.start()

    def _drain(self) -> None:
        while True:
            try:
                job_id = self._queue.get_nowait()
            except queue.Empty:
                return
            try:
                queued = self.store.get(job_id)
                work = self._work.pop(job_id, None)
                if queued is None or work is None or queued.status == AlignmentJobStatus.cancelled:
                    continue
                self._notify(self.store.mark_running(job_id))
                try:
                    # This lock is shared with TTS generation.  Post-processing
                    # only starts after final audio exists, and never contends
                    # with a new local CUDA synthesis request.
                    with local_gpu_generation_lock:
                        release_idle_runtimes_for_alignment(self.settings)
                        output = run_alignment_worker(self.settings, work, job_id, self._processes)
                    result = AlignmentResult.model_validate(output)
                    validate_alignment_result(result, work.transcript, work.duration_seconds)
                    self._write_cache(work.cache_key, result)
                except Exception as exc:
                    self._notify(self.store.mark_failed(job_id, str(exc)))
                else:
                    self._notify(self.store.mark_completed(job_id, result))
            finally:
                with self._lock:
                    self._processes.pop(job_id, None)
                self._queue.task_done()

    def _notify(self, job: AlignmentJobInfo) -> None:
        callback = self._callbacks.get(job.id)
        if callback:
            try:
                callback(job)
            except Exception:
                # Parent speech task recording must not invalidate valid work.
                pass

    def _cache_path(self, cache_key: str) -> Path:
        return self.settings.alignment_cache_dir / f"{cache_key}.json"

    def _load_cache(self, cache_key: str) -> AlignmentResult | None:
        path = self._cache_path(cache_key)
        if not path.is_file():
            return None
        try:
            return AlignmentResult.model_validate_json(path.read_text(encoding="utf-8"))
        except Exception:
            return None

    def _write_cache(self, cache_key: str, result: AlignmentResult) -> None:
        path = self._cache_path(cache_key)
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary = path.with_suffix(".tmp")
        temporary.write_text(result.model_dump_json(indent=2), encoding="utf-8")
        temporary.replace(path)


def run_alignment_worker(
    settings: Settings,
    work: AlignmentWork,
    job_id: str,
    processes: dict[str, subprocess.Popen[str]],
) -> dict:
    """Run the isolated local Qwen aligner and return its JSON-only output."""

    try:
        runtime = resolve_qwen_runtime(
            settings,
            settings.alignment_device,
            fallback_python=settings.alignment_python,
        )
    except QwenRuntimeError as exc:
        raise AlignmentWorkerError(str(exc)) from exc
    if not runtime.python_executable.is_file():
        raise AlignmentWorkerError("本地对齐 Python 运行时不存在；请检查本地 Qwen 设备运行时。")
    if not settings.alignment_capswriter_root or not settings.alignment_capswriter_root.is_dir():
        raise AlignmentWorkerError("本地 Qwen 对齐引擎目录未配置；请配置 OPEN_TTS_ALIGNMENT_CAPSWRITER_ROOT。")
    if not settings.alignment_aligner_model_dir or not settings.alignment_aligner_model_dir.is_dir():
        raise AlignmentWorkerError("本地 Qwen3-ForcedAligner 模型未配置；请配置 OPEN_TTS_ALIGNMENT_ALIGNER_MODEL_DIR。")
    settings.alignment_work_dir.mkdir(parents=True, exist_ok=True)
    request_path = settings.alignment_work_dir / f"{job_id}.request.json"
    response_path = settings.alignment_work_dir / f"{job_id}.response.json"
    request_path.write_text(
        json.dumps(
            {
                "audio_path": str(work.audio_path),
                "transcript": work.transcript,
                "language": work.language,
                "granularity": work.granularity.granularity.value,
                "duration_seconds": work.duration_seconds,
                "audio_sha256": work.audio_sha256,
                "transcript_sha256": work.transcript_sha256,
                "capswriter_root": str(settings.alignment_capswriter_root or ""),
                "aligner_model_dir": str(settings.alignment_aligner_model_dir or ""),
                "model_version": settings.alignment_model_version,
                "active_device": runtime.active_device,
                "onnx_provider": runtime.onnx_provider,
                "llm_use_gpu": runtime.llm_use_gpu,
                "cuda_backend_dir": str(runtime.llama_backend_dir or ""),
                "ffmpeg_path": settings.ffmpeg_path,
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    environment = os.environ.copy()
    # Qwen3-ForcedAligner uses explicitly configured local ONNX and GGUF
    # files. Keep Hugging Face/Transformers offline as a defence in depth for
    # any incidental imports in the configured runtime.
    environment.update({"HF_HUB_OFFLINE": "1", "TRANSFORMERS_OFFLINE": "1", "HF_HUB_DISABLE_TELEMETRY": "1", "PYTHONUTF8": "1"})
    environment = qwen_worker_environment(runtime, environment)
    process: subprocess.Popen[str] | None = None
    try:
        process = subprocess.Popen(
            [str(runtime.python_executable), str(ALIGNMENT_WORKER), "--request", str(request_path), "--output", str(response_path)],
            # CapsWriter/llama emits a large native-model diagnostic stream.
            # Never pipe it without continuously draining it: a full Windows
            # pipe deadlocks the child before its safe JSON result is written.
            # The worker's explicit response file is the only public error
            # channel, which also avoids logging media/reference paths.
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            env=environment,
        )
        processes[job_id] = process
        started = time.monotonic()
        while process.poll() is None:
            if time.monotonic() - started > settings.alignment_worker_timeout_seconds:
                process.terminate()
                raise AlignmentWorkerError("本地对齐超过时限，已终止对齐进程。")
            time.sleep(0.1)
        process.wait()
        if process.returncode != 0:
            # stderr can include process arguments; leave it out of the
            # persisted status and show only the worker's explicit safe error.
            if response_path.is_file():
                try:
                    payload = json.loads(response_path.read_text(encoding="utf-8"))
                    error = payload.get("error", {}) if isinstance(payload, dict) else {}
                    if isinstance(error, dict) and error.get("message"):
                        raise AlignmentWorkerError(str(error["message"]))
                except json.JSONDecodeError:
                    pass
            raise AlignmentWorkerError("本地 Qwen 强制对齐进程失败；请确认本地模型和运行时可用。")
        if not response_path.is_file():
            raise AlignmentWorkerError("本地 Qwen 强制对齐进程没有产生结果文件。")
        payload = json.loads(response_path.read_text(encoding="utf-8"))
        if not isinstance(payload, dict) or not payload.get("ok"):
            error = payload.get("error", {}) if isinstance(payload, dict) else {}
            message = error.get("message") if isinstance(error, dict) else None
            raise AlignmentWorkerError(str(message or "本地 Qwen 强制对齐未返回有效结果。"))
        result = payload.get("alignment")
        if not isinstance(result, dict):
            raise AlignmentWorkerError("本地 Qwen 强制对齐结果缺少 alignment 对象。")
        return result
    finally:
        for path in (request_path, response_path):
            try:
                path.unlink(missing_ok=True)
            except OSError:
                pass
        if process is not None:
            processes.pop(job_id, None)


def _work_from_result(
    request: SpeechRequest,
    result: SpeechResult,
    settings: Settings,
    speech_job_id: str | None,
) -> AlignmentWork:
    if request.alignment is None or not request.alignment.enabled:
        raise ValueError("未请求对齐。")
    audio_path = Path(result.file_path)
    sample_rate, duration_seconds = probe_audio_metadata(audio_path, settings.ffmpeg_path)
    if duration_seconds <= 0:
        raise AlignmentError("最终音频探测到的时长为零，无法执行对齐。")
    audio_sha256 = _sha256_file(audio_path)
    transcript_sha256 = _sha256_text(request.input)
    return AlignmentWork(
        audio_path=audio_path,
        audio_url=result.audio_url,
        transcript=request.input,
        language=request.alignment.language,
        granularity=request.alignment,
        duration_seconds=duration_seconds,
        sample_rate=sample_rate,
        audio_sha256=audio_sha256,
        transcript_sha256=transcript_sha256,
        cache_key=_cache_key(audio_sha256, transcript_sha256, settings.alignment_model_version),
        speech_job_id=speech_job_id,
    )


def _work_from_speech_job(job: AlignmentJobInfo, settings: Settings) -> AlignmentWork:
    if not job.speech_job_id:
        raise AlignmentError("该对齐任务没有可重试的语音任务来源。")
    from tts_api.jobs import get_job_store

    speech_job = get_job_store(settings).get(job.speech_job_id)
    if speech_job is None or speech_job.result is None:
        raise AlignmentError("原始语音任务或最终音频已不可用，无法重试对齐。")
    request = speech_job.request.model_copy(
        update={
            "alignment": AlignmentRequest(enabled=True, language=job.language, granularity=job.granularity),
        }
    )
    return _work_from_result(request, speech_job.result, settings, job.speech_job_id)


def _parent_speech_callback(speech_job_id: str | None) -> Callable[[AlignmentJobInfo], None] | None:
    if not speech_job_id:
        return None

    def callback(alignment_job: AlignmentJobInfo) -> None:
        from tts_api.jobs import get_job_store

        get_job_store().attach_alignment(speech_job_id, alignment_job)

    return callback


def schedule_alignment(
    request: SpeechRequest,
    result: SpeechResult,
    speech_job_id: str | None,
    settings: Settings | None = None,
) -> tuple[SpeechResult, AlignmentJobInfo | None]:
    """Attach an asynchronous (or explicitly awaited) alignment to final audio."""

    if request.alignment is None or not request.alignment.enabled:
        return result, None
    active_settings = settings or get_settings()
    try:
        work = _work_from_result(request, result, active_settings, speech_job_id)
    except Exception as exc:
        # A failed alignment does not discard successfully generated audio.
        # It does remain explicit and trackable instead of returning invented
        # timestamps or an optimistic pending status.
        audio_path = Path(result.file_path)
        job = _create_unavailable_alignment_job(request, result, speech_job_id, active_settings, audio_path, str(exc))
        return with_alignment(result, job), job

    runner = get_alignment_runner(active_settings)
    job = runner.enqueue(work, on_update=_parent_speech_callback(speech_job_id))
    if request.alignment.wait_for_result and job.status in {AlignmentJobStatus.queued, AlignmentJobStatus.running}:
        job = wait_for_alignment(job.id, settings=active_settings)
    return with_alignment(result.model_copy(update={"sample_rate": work.sample_rate, "duration_seconds": work.duration_seconds}), job), job


def _create_unavailable_alignment_job(
    request: SpeechRequest,
    result: SpeechResult,
    speech_job_id: str | None,
    settings: Settings,
    audio_path: Path,
    error: str,
) -> AlignmentJobInfo:
    # This is only reached when final-audio probing/hashing fails.  Hashes are
    # intentionally opaque placeholders because no cache lookup is possible.
    audio_sha256 = _sha256_file(audio_path) if audio_path.is_file() else "unavailable"
    transcript_sha256 = _sha256_text(request.input)
    work = AlignmentWork(
        audio_path=audio_path,
        audio_url=result.audio_url,
        transcript=request.input,
        language=request.alignment.language if request.alignment else "zh",
        granularity=request.alignment or AlignmentRequest(enabled=True),
        duration_seconds=max(0.0, result.duration_seconds),
        sample_rate=max(0, result.sample_rate),
        audio_sha256=audio_sha256,
        transcript_sha256=transcript_sha256,
        cache_key=_cache_key(audio_sha256, transcript_sha256, settings.alignment_model_version),
        speech_job_id=speech_job_id,
    )
    job = get_alignment_store(settings).create(work, settings)
    return get_alignment_store(settings).mark_failed(job.id, f"无法读取最终音频，未执行对齐：{error}")


def wait_for_alignment(job_id: str, settings: Settings | None = None) -> AlignmentJobInfo:
    active_settings = settings or get_settings()
    store = get_alignment_store(active_settings)
    timeout = active_settings.alignment_worker_timeout_seconds + 10
    started = time.monotonic()
    while time.monotonic() - started < timeout:
        job = store.get(job_id)
        if job is None:
            raise KeyError(job_id)
        if job.status in {AlignmentJobStatus.completed, AlignmentJobStatus.failed, AlignmentJobStatus.cancelled}:
            return job
        time.sleep(0.05)
    raise AlignmentWorkerError("等待本地对齐结果超时。")


_alignment_stores: dict[str, AlignmentJobStore] = {}
_alignment_runners: dict[str, AlignmentRunner] = {}


def get_alignment_store(settings: Settings | None = None) -> AlignmentJobStore:
    active_settings = settings or get_settings()
    key = str(active_settings.alignment_jobs_file)
    if key not in _alignment_stores:
        _alignment_stores[key] = AlignmentJobStore(active_settings.alignment_jobs_file)
    return _alignment_stores[key]


def get_alignment_runner(settings: Settings | None = None) -> AlignmentRunner:
    active_settings = settings or get_settings()
    key = str(active_settings.alignment_jobs_file)
    if key not in _alignment_runners:
        _alignment_runners[key] = AlignmentRunner(get_alignment_store(active_settings), active_settings)
    return _alignment_runners[key]
