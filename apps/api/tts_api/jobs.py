from __future__ import annotations

import json
import queue
import threading
from pathlib import Path
from typing import Callable
from uuid import uuid4

from tts_api.config import Settings, get_settings
from tts_api.schemas import JobInfo, JobStatus, SpeechRequest, SpeechResult, TaskEvent, utc_now


MAX_STORED_JOBS = 200
MAX_STORED_EVENTS = 80


class JobStore:
    """Persistent recent job history with small, human-readable diagnostic logs."""

    def __init__(self, tasks_file: Path, log_dir: Path):
        self.tasks_file = tasks_file
        self.log_dir = log_dir
        self._lock = threading.RLock()

    def list(self, limit: int = 100) -> list[JobInfo]:
        with self._lock:
            jobs = sorted(self._load().values(), key=lambda job: job.created_at, reverse=True)
            return jobs[:limit]

    def get(self, job_id: str) -> JobInfo | None:
        with self._lock:
            return self._load().get(job_id)

    def create(self, request: SpeechRequest, retry_of: str | None = None) -> JobInfo:
        with self._lock:
            job_id = uuid4().hex
            job = JobInfo(
                id=job_id,
                status=JobStatus.queued,
                request=request,
                log_file=str(self.log_dir / f"{job_id}.log"),
                retry_of=retry_of,
            )
            return self._update(job, TaskEvent(stage="queued", message="任务已进入本地串行队列。"))

    def mark_running(self, job_id: str) -> JobInfo:
        with self._lock:
            job = self._require(job_id)
            if job.status == JobStatus.cancelled:
                return job
            return self._update(
                job.model_copy(update={"status": JobStatus.running, "stage": "validating", "progress_percent": 5, "started_at": utc_now()}),
                TaskEvent(stage="validating", message="正在校验请求、模型能力与本地配置。"),
            )

    def report_progress(self, job_id: str, stage: str, progress_percent: int, message: str) -> JobInfo:
        with self._lock:
            job = self._require(job_id)
            if job.status != JobStatus.running:
                return job
            return self._update(
                job.model_copy(update={"stage": stage, "progress_percent": max(0, min(99, progress_percent))}),
                TaskEvent(stage=stage, message=message),
            )

    def mark_succeeded(self, job_id: str, result: SpeechResult) -> JobInfo:
        with self._lock:
            job = self._require(job_id)
            return self._update(
                job.model_copy(
                    update={
                        "status": JobStatus.succeeded,
                        "stage": "completed",
                        "progress_percent": 100,
                        "result": result,
                        "error": None,
                        "completed_at": utc_now(),
                    }
                ),
                TaskEvent(stage="completed", message="音频已生成并写入输出目录。"),
            )

    def mark_failed(self, job_id: str, error: str) -> JobInfo:
        with self._lock:
            job = self._require(job_id)
            return self._update(
                job.model_copy(
                    update={
                        "status": JobStatus.failed,
                        "stage": "failed",
                        "error": error,
                        "completed_at": utc_now(),
                    }
                ),
                TaskEvent(stage="failed", message=error, level="error"),
            )

    def cancel(self, job_id: str) -> JobInfo:
        with self._lock:
            job = self._require(job_id)
            if job.status == JobStatus.cancelled:
                return job
            if job.status != JobStatus.queued:
                raise RuntimeError("任务已经开始执行，不能安全中断当前模型推理。")
            return self._update(
                job.model_copy(
                    update={
                        "status": JobStatus.cancelled,
                        "stage": "cancelled",
                        "completed_at": utc_now(),
                    }
                ),
                TaskEvent(stage="cancelled", message="排队任务已取消。"),
            )

    def recover_after_restart(self) -> list[str]:
        """Resume queued work and make interrupted inference safely retryable."""
        with self._lock:
            jobs = self._load()
            queued_job_ids: list[str] = []
            changed = False
            for job in jobs.values():
                if job.status == JobStatus.queued:
                    queued_job_ids.append(job.id)
                    continue
                if job.status != JobStatus.running:
                    continue
                error = "本地服务已重启，无法确认正在执行的模型推理是否完成，请重试该任务。"
                event = TaskEvent(stage="interrupted", message=error, level="error")
                recovered = job.model_copy(
                    update={
                        "status": JobStatus.failed,
                        "stage": "interrupted",
                        "error": error,
                        "completed_at": event.occurred_at,
                        "events": [*job.events, event][-MAX_STORED_EVENTS:],
                    }
                )
                jobs[recovered.id] = recovered
                self._append_log(recovered, event)
                changed = True
            if changed:
                self._save(jobs)
            return sorted(queued_job_ids, key=lambda job_id: jobs[job_id].created_at)

    def _require(self, job_id: str) -> JobInfo:
        job = self._load().get(job_id)
        if job is None:
            raise KeyError(job_id)
        return job

    def _update(self, job: JobInfo, event: TaskEvent | None = None) -> JobInfo:
        events = list(job.events)
        if event is not None:
            events = [*events, event][-MAX_STORED_EVENTS:]
        updated = job.model_copy(update={"events": events})
        jobs = self._load()
        jobs[updated.id] = updated
        self._save(jobs)
        if event is not None:
            self._append_log(updated, event)
        return updated

    def _append_log(self, job: JobInfo, event: TaskEvent) -> None:
        if not job.log_file:
            return
        try:
            log_path = Path(job.log_file)
            log_path.parent.mkdir(parents=True, exist_ok=True)
            with log_path.open("a", encoding="utf-8") as handle:
                handle.write(f"{event.occurred_at.isoformat()} [{event.level}] {event.stage}: {event.message}\n")
        except OSError:
            return

    def _load(self) -> dict[str, JobInfo]:
        if not self.tasks_file.exists():
            return {}
        try:
            payload = json.loads(self.tasks_file.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return {}
        raw_jobs = payload.get("jobs", []) if isinstance(payload, dict) else []
        jobs: dict[str, JobInfo] = {}
        for raw in raw_jobs:
            try:
                job = JobInfo.model_validate(raw)
            except Exception:
                continue
            jobs[job.id] = job
        return jobs

    def _save(self, jobs: dict[str, JobInfo]) -> None:
        recent = sorted(jobs.values(), key=lambda job: job.created_at, reverse=True)[:MAX_STORED_JOBS]
        self.tasks_file.parent.mkdir(parents=True, exist_ok=True)
        self.tasks_file.write_text(
            json.dumps({"jobs": [job.model_dump(mode="json") for job in recent]}, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )


class JobRunner:
    """One local worker keeps direct speech jobs from competing for GPU memory."""

    def __init__(self, store: JobStore, synthesize: Callable[..., SpeechResult]):
        self.store = store
        self.synthesize = synthesize
        self._queue: queue.Queue[str] = queue.Queue()
        self._lock = threading.Lock()
        self._worker: threading.Thread | None = None
        for job_id in self.store.recover_after_restart():
            self._queue.put(job_id)
        if not self._queue.empty():
            self._start_worker_if_needed()

    def enqueue(self, request: SpeechRequest, retry_of: str | None = None) -> JobInfo:
        job = self.store.create(request, retry_of=retry_of)
        self._queue.put(job.id)
        self._start_worker_if_needed()

        return job

    def _start_worker_if_needed(self) -> None:
        with self._lock:
            if self._worker is None or not self._worker.is_alive():
                self._worker = threading.Thread(target=self._drain, name="open-tts-job-runner", daemon=True)
                self._worker.start()

    def retry(self, job_id: str) -> JobInfo:
        job = self.store.get(job_id)
        if job is None:
            raise KeyError(job_id)
        if job.status not in {JobStatus.failed, JobStatus.cancelled}:
            raise RuntimeError("仅失败或已取消的任务可以重试。")
        return self.enqueue(job.request, retry_of=job.id)

    def cancel(self, job_id: str) -> JobInfo:
        return self.store.cancel(job_id)

    def _drain(self) -> None:
        while True:
            try:
                job_id = self._queue.get_nowait()
            except queue.Empty:
                return
            try:
                job = self.store.get(job_id)
                if job is None or job.status == JobStatus.cancelled:
                    continue
                self.store.mark_running(job_id)
                try:
                    result = self.synthesize(
                        job.request,
                        progress_reporter=lambda stage, progress, message: self.store.report_progress(
                            job_id, stage, progress, message
                        ),
                    )
                except Exception as exc:
                    self.store.mark_failed(job_id, str(exc))
                else:
                    self.store.mark_succeeded(job_id, result)
            finally:
                self._queue.task_done()


_job_stores: dict[str, JobStore] = {}
_job_runners: dict[str, JobRunner] = {}


def get_job_store(settings: Settings | None = None) -> JobStore:
    active_settings = settings or get_settings()
    key = str(active_settings.tasks_file)
    if key not in _job_stores:
        _job_stores[key] = JobStore(active_settings.tasks_file, active_settings.task_log_dir)
    return _job_stores[key]


def get_job_runner(settings: Settings | None = None) -> JobRunner:
    active_settings = settings or get_settings()
    key = str(active_settings.tasks_file)
    if key not in _job_runners:
        from tts_api.routes.speech import synthesize_with_registered_adapter

        _job_runners[key] = JobRunner(get_job_store(active_settings), synthesize_with_registered_adapter)
    return _job_runners[key]


def run_tracked_synthesis(request: SpeechRequest, synthesize: Callable[..., SpeechResult]) -> SpeechResult:
    """Keep synchronous OpenAI-compatible calls visible in the task history too."""

    store = get_job_store()
    job = store.create(request)
    store.mark_running(job.id)
    try:
        result = synthesize(
            request,
            progress_reporter=lambda stage, progress, message: store.report_progress(job.id, stage, progress, message),
        )
    except Exception as exc:
        store.mark_failed(job.id, str(exc))
        raise
    store.mark_succeeded(job.id, result)
    return result
