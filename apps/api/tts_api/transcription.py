"""Managed local audio/video transcription jobs and truthful TXT/SRT exports.

TXT can use the selected lightweight local ASR.  SRT is intentionally more
strict: it is available only after Qwen3-ASR plus Qwen3-ForcedAligner has
returned actual token timestamps for the imported media.  The implementation
never turns a plain transcript into estimated cue durations.
"""

from __future__ import annotations

import json
import queue
import re
import subprocess
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Callable
from uuid import uuid4

from tts_api.adapters.asr import get_local_transcriber
from tts_api.adapters.qwen_asr import QwenASRTranscriber, TimestampedQwenTranscription
from tts_api.audio import probe_audio_metadata
from tts_api.config import Settings, get_settings
from tts_api.runtime_memory import local_gpu_generation_lock, release_conflicting_runtimes
from tts_api.schemas import (
    TranscriptionBackend,
    TranscriptionJobInfo,
    TranscriptionJobRequest,
    TranscriptionJobStatus,
    TranscriptionOutputFormat,
    TranscriptionSegment,
    TranscriptionToken,
    utc_now,
)


MAX_STORED_TRANSCRIPTION_JOBS = 200
_INPUT_ID_RE = re.compile(r"^[a-f0-9]{32}$")
_DRIVE_PATH_RE = re.compile(r"[A-Za-z]:[\\/][^\s]+")


class TranscriptionError(RuntimeError):
    """A controlled local transcription error that is safe to persist."""


@dataclass(frozen=True)
class TranscriptionWork:
    request: TranscriptionJobRequest
    input_path: Path
    file_size_bytes: int


def _safe_error(error: Exception | str) -> str:
    value = str(error).replace("\r", " ").replace("\n", " ").strip()
    value = _DRIVE_PATH_RE.sub("<本地路径>", value)
    return value[:1000] or "本地音视频转写失败。"


def _safe_file_name(value: str) -> str:
    name = Path(value or "").name
    if not name or name != value or any(character in name for character in ("\x00", "\r", "\n")):
        raise TranscriptionError("媒体文件名无效。")
    return name


def managed_input_path(input_id: str, settings: Settings) -> Path:
    """Resolve only opaque files created in OpenTTS's own input directory."""

    if not _INPUT_ID_RE.fullmatch(input_id):
        raise TranscriptionError("媒体导入标识无效，请重新选择本地文件。")
    root = settings.transcription_input_dir
    if not root.is_dir():
        raise TranscriptionError("找不到受控的媒体导入文件，请重新选择本地文件。")
    candidates = [path for path in root.glob(f"{input_id}.*") if path.is_file()]
    # UUID media files have one regular extension.  Metadata/sidecar files are
    # never used as media, and ambiguous IDs are rejected instead of guessed.
    candidates = [path for path in candidates if path.suffix.lower() not in {".json", ".tmp", ".part"}]
    if len(candidates) != 1:
        raise TranscriptionError("找不到受控的媒体导入文件，请重新选择本地文件。")
    return candidates[0]


def _build_work(request: TranscriptionJobRequest, settings: Settings) -> TranscriptionWork:
    source_file_name = _safe_file_name(request.source_file_name)
    input_path = managed_input_path(request.input_id, settings)
    try:
        size = input_path.stat().st_size
    except OSError as exc:
        raise TranscriptionError("无法读取受控媒体导入文件。") from exc
    if size <= 0 or size > settings.transcription_max_input_bytes:
        raise TranscriptionError("媒体文件为空或超过本地转写允许的大小。")
    if request.output_format == TranscriptionOutputFormat.srt and request.backend != TranscriptionBackend.qwen3:
        raise TranscriptionError("真实 SRT 需要 Qwen3-ASR 与 Qwen3-ForcedAligner；SenseVoice 只能导出 TXT。")
    return TranscriptionWork(
        request=request.model_copy(update={"source_file_name": source_file_name}),
        input_path=input_path,
        file_size_bytes=size,
    )


class TranscriptionJobStore:
    def __init__(self, jobs_file: Path):
        self.jobs_file = jobs_file
        self._lock = threading.RLock()

    def list(self, limit: int = 100) -> list[TranscriptionJobInfo]:
        with self._lock:
            return sorted(self._load().values(), key=lambda job: job.created_at, reverse=True)[:limit]

    def get(self, job_id: str) -> TranscriptionJobInfo | None:
        with self._lock:
            return self._load().get(job_id)

    def create(self, work: TranscriptionWork, retry_of: str | None = None) -> TranscriptionJobInfo:
        with self._lock:
            request = work.request
            job = TranscriptionJobInfo(
                id=uuid4().hex,
                status=TranscriptionJobStatus.queued,
                input_id=request.input_id,
                source_file_name=request.source_file_name,
                source_file_size_bytes=work.file_size_bytes,
                backend=request.backend,
                output_format=request.output_format,
                language=request.language,
                retry_of=retry_of,
            )
            return self._save_job(job)

    def mark_running(self, job_id: str) -> TranscriptionJobInfo:
        with self._lock:
            job = self._require(job_id)
            if job.status == TranscriptionJobStatus.cancelled:
                return job
            return self._save_job(
                job.model_copy(
                    update={
                        "status": TranscriptionJobStatus.running,
                        "stage": "recognizing",
                        "progress_percent": 10,
                        "started_at": utc_now(),
                        "error": None,
                    }
                )
            )

    def mark_completed(
        self,
        job_id: str,
        *,
        text: str,
        model: str,
        duration_seconds: float,
        tokens: list[TranscriptionToken] | None = None,
        segments: list[TranscriptionSegment] | None = None,
        warnings: list[str] | None = None,
    ) -> TranscriptionJobInfo:
        with self._lock:
            job = self._require(job_id)
            if job.status == TranscriptionJobStatus.cancelled:
                return job
            return self._save_job(
                job.model_copy(
                    update={
                        "status": TranscriptionJobStatus.completed,
                        "stage": "completed",
                        "progress_percent": 100,
                        "text": text,
                        "model": model,
                        "duration_seconds": duration_seconds,
                        "tokens": tokens or [],
                        "segments": segments or [],
                        "warnings": warnings or [],
                        "error": None,
                        "completed_at": utc_now(),
                    }
                )
            )

    def mark_failed(self, job_id: str, error: Exception | str) -> TranscriptionJobInfo:
        with self._lock:
            job = self._require(job_id)
            if job.status == TranscriptionJobStatus.cancelled:
                return job
            return self._save_job(
                job.model_copy(
                    update={
                        "status": TranscriptionJobStatus.failed,
                        "stage": "failed",
                        "error": _safe_error(error),
                        "completed_at": utc_now(),
                    }
                )
            )

    def cancel(self, job_id: str, force_running: bool = False) -> TranscriptionJobInfo:
        with self._lock:
            job = self._require(job_id)
            if job.status == TranscriptionJobStatus.cancelled:
                return job
            if job.status == TranscriptionJobStatus.running and not force_running:
                raise TranscriptionError("转写正在运行；请使用 force=true 终止当前本地模型任务。")
            if job.status not in {TranscriptionJobStatus.queued, TranscriptionJobStatus.running}:
                raise TranscriptionError("仅排队或运行中的转写任务可以取消。")
            return self._save_job(
                job.model_copy(
                    update={
                        "status": TranscriptionJobStatus.cancelled,
                        "stage": "cancelled",
                        "error": "用户取消了本地音视频转写任务。",
                        "completed_at": utc_now(),
                    }
                )
            )

    def recover_after_restart(self) -> None:
        with self._lock:
            jobs = self._load()
            changed = False
            for job_id, job in list(jobs.items()):
                if job.status not in {TranscriptionJobStatus.queued, TranscriptionJobStatus.running}:
                    continue
                jobs[job_id] = job.model_copy(
                    update={
                        "status": TranscriptionJobStatus.failed,
                        "stage": "interrupted",
                        "error": "本地服务已重启；转写任务未完成，可使用重试继续。",
                        "completed_at": utc_now(),
                    }
                )
                changed = True
            if changed:
                self._save(jobs)

    def _require(self, job_id: str) -> TranscriptionJobInfo:
        job = self._load().get(job_id)
        if job is None:
            raise KeyError(job_id)
        return job

    def _save_job(self, job: TranscriptionJobInfo) -> TranscriptionJobInfo:
        jobs = self._load()
        jobs[job.id] = job
        self._save(jobs)
        return job

    def _load(self) -> dict[str, TranscriptionJobInfo]:
        if not self.jobs_file.is_file():
            return {}
        try:
            payload = json.loads(self.jobs_file.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return {}
        items = payload.get("transcriptions", []) if isinstance(payload, dict) else []
        jobs: dict[str, TranscriptionJobInfo] = {}
        for item in items:
            try:
                job = TranscriptionJobInfo.model_validate(item)
            except Exception:
                continue
            jobs[job.id] = job
        return jobs

    def _save(self, jobs: dict[str, TranscriptionJobInfo]) -> None:
        recent = sorted(jobs.values(), key=lambda job: job.created_at, reverse=True)[:MAX_STORED_TRANSCRIPTION_JOBS]
        self.jobs_file.parent.mkdir(parents=True, exist_ok=True)
        temporary = self.jobs_file.with_suffix(".tmp")
        temporary.write_text(
            json.dumps({"transcriptions": [job.model_dump(mode="json") for job in recent]}, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        temporary.replace(self.jobs_file)


def _format_srt_time(seconds: float) -> str:
    total_milliseconds = max(0, round(seconds * 1000))
    hours, remainder = divmod(total_milliseconds, 3_600_000)
    minutes, remainder = divmod(remainder, 60_000)
    whole_seconds, milliseconds = divmod(remainder, 1000)
    return f"{hours:02d}:{minutes:02d}:{whole_seconds:02d},{milliseconds:03d}"


def generate_srt(job: TranscriptionJobInfo) -> str:
    if job.status != TranscriptionJobStatus.completed or not job.segments:
        raise TranscriptionError("当前任务没有可导出的真实时间轴 SRT。")
    return "\n".join(
        f"{index}\n{_format_srt_time(segment.start_seconds)} --> {_format_srt_time(segment.end_seconds)}\n{segment.text}\n"
        for index, segment in enumerate(job.segments, start=1)
    )


def _tokens_from_timestamps(result: TimestampedQwenTranscription, duration_seconds: float) -> list[TranscriptionToken]:
    if len(result.tokens) != len(result.timestamps):
        raise TranscriptionError("Qwen3 时间轴 token 数与时间戳数不一致。")
    if abs(result.duration_seconds - duration_seconds) > 0.15:
        raise TranscriptionError("Qwen3 识别到的音频时长与媒体探测值不一致，拒绝生成不可靠字幕。")
    collapsed: list[tuple[str, float]] = []
    last_start = -1.0
    for raw_token, raw_start in zip(result.tokens, result.timestamps):
        token = str(raw_token).strip()
        start = float(raw_start)
        if not token:
            continue
        if start < 0 or start > duration_seconds or start + 1e-6 < last_start:
            raise TranscriptionError("Qwen3 返回了越界或非单调的真实时间戳。")
        if collapsed and abs(start - collapsed[-1][1]) <= 1e-6:
            collapsed[-1] = (f"{collapsed[-1][0]}{token}", collapsed[-1][1])
        else:
            collapsed.append((token, start))
        last_start = start
    if not collapsed:
        raise TranscriptionError("Qwen3 未返回有效的真实字幕时间戳。")
    entries: list[TranscriptionToken] = []
    for index, (text, start) in enumerate(collapsed):
        end = collapsed[index + 1][1] if index + 1 < len(collapsed) else duration_seconds
        if end <= start:
            raise TranscriptionError("Qwen3 返回了无效的真实字幕时间边界。")
        entries.append(TranscriptionToken(text=text, start_seconds=start, end_seconds=end))
    return entries


_SENTENCE_END_RE = re.compile(r"[。！？!?]$")
_CLAUSE_END_RE = re.compile(r"[，、；;：:]$")
_TEXT_COMPARE_RE = re.compile(r"[\s，。！？!?,、；;：:…]+")


def _subtitle_display_length(value: str) -> int:
    return len(re.sub(r"\s+", "", value))


def _comparable_text(value: str) -> str:
    return _TEXT_COMPARE_RE.sub("", value or "")


def build_subtitle_segments(tokens: list[TranscriptionToken], max_chars: int = 12) -> list[TranscriptionSegment]:
    """Group real token bounds only; no character-duration interpolation.

    This mirrors the Chinese-friendly cue policy in the companion PR tooling:
    favor punctuation and short, readable cues while retaining the first and
    last actual ASR/aligner boundaries of every output cue.
    """

    segments: list[TranscriptionSegment] = []
    current: list[TranscriptionToken] = []

    def flush() -> None:
        if not current:
            return
        text = "".join(item.text for item in current).strip()
        if text:
            segments.append(
                TranscriptionSegment(
                    id=f"seg_{len(segments) + 1:03d}",
                    text=text,
                    start_seconds=current[0].start_seconds,
                    end_seconds=current[-1].end_seconds,
                )
            )
        current.clear()

    for token in tokens:
        current_text = "".join(item.text for item in current)
        if current and _subtitle_display_length(f"{current_text}{token.text}") > max_chars:
            flush()
        current.append(token)
        cue_text = "".join(item.text for item in current)
        if _SENTENCE_END_RE.search(cue_text) or (
            _CLAUSE_END_RE.search(cue_text) and _subtitle_display_length(cue_text) >= max_chars - 3
        ) or _subtitle_display_length(cue_text) >= max_chars:
            flush()
    flush()
    previous_end = 0.0
    for segment in segments:
        if segment.start_seconds + 1e-6 < previous_end or segment.end_seconds <= segment.start_seconds:
            raise TranscriptionError("生成的 SRT 分段不具备单调的真实时间轴。")
        previous_end = segment.end_seconds
    return segments


class TranscriptionRunner:
    def __init__(self, store: TranscriptionJobStore, settings: Settings):
        self.store = store
        self.settings = settings
        self._queue: queue.Queue[str] = queue.Queue()
        self._work: dict[str, TranscriptionWork] = {}
        self._processes: dict[str, subprocess.Popen] = {}
        self._lock = threading.RLock()
        self._worker: threading.Thread | None = None
        self.store.recover_after_restart()

    def reconfigure(self, settings: Settings) -> None:
        """Apply saved runtime paths before the next queued job starts."""
        with self._lock:
            self.settings = settings

    def enqueue(self, request: TranscriptionJobRequest, retry_of: str | None = None) -> TranscriptionJobInfo:
        work = _build_work(request, self.settings)
        job = self.store.create(work, retry_of=retry_of)
        with self._lock:
            self._work[job.id] = work
            self._queue.put(job.id)
            self._start_worker_if_needed()
        return self.store.get(job.id) or job

    def retry(self, job_id: str) -> TranscriptionJobInfo:
        job = self.store.get(job_id)
        if job is None:
            raise KeyError(job_id)
        if job.status not in {TranscriptionJobStatus.failed, TranscriptionJobStatus.cancelled}:
            raise TranscriptionError("仅失败或已取消的转写任务可以重试。")
        return self.enqueue(
            TranscriptionJobRequest(
                input_id=job.input_id,
                source_file_name=job.source_file_name,
                backend=job.backend,
                output_format=job.output_format,
                language=job.language,
            ),
            retry_of=job.id,
        )

    def cancel(self, job_id: str, force_running: bool = False) -> TranscriptionJobInfo:
        job = self.store.cancel(job_id, force_running=force_running)
        if force_running:
            with self._lock:
                process = self._processes.get(job_id)
                if process is not None and process.poll() is None:
                    process.terminate()
            if job.backend == TranscriptionBackend.sensevoice:
                from tts_api.adapters.sensevoice import release_sensevoice_service

                release_sensevoice_service(self.settings, force=True)
        return job

    def _start_worker_if_needed(self) -> None:
        if self._worker is None or not self._worker.is_alive():
            self._worker = threading.Thread(target=self._drain, name="open-tts-transcription-runner", daemon=True)
            self._worker.start()

    def _drain(self) -> None:
        while True:
            try:
                job_id = self._queue.get_nowait()
            except queue.Empty:
                return
            try:
                job = self.store.get(job_id)
                work = self._work.pop(job_id, None)
                if job is None or work is None or job.status == TranscriptionJobStatus.cancelled:
                    continue
                self.store.mark_running(job_id)
                try:
                    self._run_work(job_id, work)
                except Exception as exc:
                    self.store.mark_failed(job_id, exc)
            finally:
                with self._lock:
                    self._processes.pop(job_id, None)
                self._queue.task_done()

    def _run_work(self, job_id: str, work: TranscriptionWork) -> None:
        settings = self.settings
        _sample_rate, duration_seconds = probe_audio_metadata(work.input_path, settings.ffmpeg_path)
        if duration_seconds <= 0:
            raise TranscriptionError("媒体音轨时长为零，无法进行本地转写。")
        with local_gpu_generation_lock:
            if work.request.backend == TranscriptionBackend.qwen3:
                transcriber = QwenASRTranscriber(settings)
                release_conflicting_runtimes(transcriber.runtime_model_id, settings)
                if work.request.output_format == TranscriptionOutputFormat.srt:
                    timed = transcriber.transcribe_timestamped_path(
                        work.input_path,
                        language=work.request.language,
                        on_process=lambda process: self._track_process(job_id, process),
                    )
                    tokens = _tokens_from_timestamps(timed, duration_seconds)
                    segments = build_subtitle_segments(tokens)
                    text = timed.raw_text or timed.text
                    warnings: list[str] = []
                    token_text = "".join(token.text for token in tokens)
                    if _comparable_text(text) != _comparable_text(token_text):
                        warnings.append("asr_alignment_text_mismatch: 已保留原始 ASR 文本与真实时间轴 token，请复核字幕。")
                    self.store.mark_completed(
                        job_id,
                        text=text,
                        model=timed.model,
                        duration_seconds=duration_seconds,
                        tokens=tokens,
                        segments=segments,
                        warnings=warnings,
                    )
                    return
            transcriber = get_local_transcriber(settings, backend=work.request.backend.value)
            release_conflicting_runtimes(transcriber.runtime_model_id, settings)
            text = transcriber.transcribe_path(work.input_path, language=work.request.language)
        self.store.mark_completed(
            job_id,
            text=text,
            model=transcriber.model_name,
            duration_seconds=duration_seconds,
            warnings=[],
        )

    def _track_process(self, job_id: str, process: subprocess.Popen) -> None:
        with self._lock:
            self._processes[job_id] = process


_stores: dict[str, TranscriptionJobStore] = {}
_runners: dict[str, TranscriptionRunner] = {}


def get_transcription_store(settings: Settings | None = None) -> TranscriptionJobStore:
    active = settings or get_settings()
    key = str(active.transcription_jobs_file)
    if key not in _stores:
        _stores[key] = TranscriptionJobStore(active.transcription_jobs_file)
    return _stores[key]


def get_transcription_runner(settings: Settings | None = None) -> TranscriptionRunner:
    active = settings or get_settings()
    key = str(active.transcription_jobs_file)
    if key not in _runners:
        _runners[key] = TranscriptionRunner(get_transcription_store(active), active)
    else:
        _runners[key].reconfigure(active)
    return _runners[key]
