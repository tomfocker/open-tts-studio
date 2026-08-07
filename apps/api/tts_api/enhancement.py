"""Managed local speech-enhancement comparison jobs.

The core API deliberately does not import PyTorch, DeepFilterNet or ClearVoice.
Those packages live in an opt-in local Python runtime, invoked through the small
worker in ``tools/run_audio_enhancement.py``.  This keeps the normal desktop
installation light while retaining the same controlled-import and GPU-serial
semantics used by ASR and TTS.
"""

from __future__ import annotations

import json
import queue
import re
import shutil
import subprocess
import threading
from dataclasses import dataclass
from pathlib import Path
from uuid import uuid4

from tts_api.audio import create_output_path, probe_audio_metadata
from tts_api.config import Settings, get_settings
from tts_api.runtime_memory import local_gpu_generation_lock, release_conflicting_runtimes
from tts_api.schemas import (
    AudioEnhancementBackend,
    AudioEnhancementJobInfo,
    AudioEnhancementJobRequest,
    AudioEnhancementJobStatus,
    AudioEnhancementOutput,
    utc_now,
)


MAX_STORED_AUDIO_ENHANCEMENT_JOBS = 200
_INPUT_ID_RE = re.compile(r"^[a-f0-9]{32}$")
_DRIVE_PATH_RE = re.compile(r"[A-Za-z]:[\\/][^\s]+")
_BACKEND_MODELS = {
    AudioEnhancementBackend.deepfilternet3: ("deepfilternet3", "DeepFilterNet3"),
    AudioEnhancementBackend.mossformer2_se_48k: ("mossformer2-se-48k", "MossFormer2_SE_48K"),
}


def _model_dir_for_backend(backend: AudioEnhancementBackend, settings: Settings) -> Path:
    if backend == AudioEnhancementBackend.deepfilternet3:
        root = settings.deepfilternet3_root
        if not (root / "config.ini").is_file() or not (root / "checkpoints").is_dir():
            raise AudioEnhancementError("DeepFilterNet3 模型包不完整；请选择包含 config.ini 与 checkpoints 的目录。")
        return root
    root = settings.mossformer2_se_root
    if not (root / "last_best_checkpoint").is_file() or not (root / "last_best_checkpoint.pt").is_file():
        raise AudioEnhancementError("MossFormer2_SE_48K 模型包不完整；请选择包含 last_best_checkpoint.pt 的目录。")
    return root


class AudioEnhancementError(RuntimeError):
    """A safe, user-visible local enhancement failure."""


@dataclass(frozen=True)
class AudioEnhancementWork:
    request: AudioEnhancementJobRequest
    input_path: Path
    file_size_bytes: int


def _safe_error(error: Exception | str) -> str:
    value = str(error).replace("\r", " ").replace("\n", " ").strip()
    value = _DRIVE_PATH_RE.sub("<本地路径>", value)
    return value[:1000] or "本地语音增强失败。"


def _safe_file_name(value: str) -> str:
    name = Path(value or "").name
    if not name or name != value or any(character in name for character in ("\x00", "\r", "\n")):
        raise AudioEnhancementError("媒体文件名无效。")
    return name


def managed_input_path(input_id: str, settings: Settings) -> Path:
    """Resolve one opaque file stored by the audio-enhancement importer."""

    if not _INPUT_ID_RE.fullmatch(input_id):
        raise AudioEnhancementError("媒体导入标识无效，请重新选择本地文件。")
    root = settings.audio_enhancement_input_dir
    if not root.is_dir():
        raise AudioEnhancementError("找不到受控的媒体导入文件，请重新选择本地文件。")
    candidates = [path for path in root.glob(f"{input_id}.*") if path.is_file()]
    candidates = [path for path in candidates if path.suffix.lower() not in {".json", ".tmp", ".part"}]
    if len(candidates) != 1:
        raise AudioEnhancementError("找不到受控的媒体导入文件，请重新选择本地文件。")
    return candidates[0]


def _build_work(request: AudioEnhancementJobRequest, settings: Settings) -> AudioEnhancementWork:
    source_file_name = _safe_file_name(request.source_file_name)
    input_path = managed_input_path(request.input_id, settings)
    try:
        file_size_bytes = input_path.stat().st_size
    except OSError as exc:
        raise AudioEnhancementError("无法读取受控媒体导入文件。") from exc
    if file_size_bytes <= 0 or file_size_bytes > settings.transcription_max_input_bytes:
        raise AudioEnhancementError("媒体文件为空或超过本地处理允许的大小。")
    return AudioEnhancementWork(
        request=request.model_copy(update={"source_file_name": source_file_name}),
        input_path=input_path,
        file_size_bytes=file_size_bytes,
    )


class AudioEnhancementJobStore:
    def __init__(self, jobs_file: Path):
        self.jobs_file = jobs_file
        self._lock = threading.RLock()

    def list(self, limit: int = 100) -> list[AudioEnhancementJobInfo]:
        with self._lock:
            return sorted(self._load().values(), key=lambda job: job.created_at, reverse=True)[:limit]

    def get(self, job_id: str) -> AudioEnhancementJobInfo | None:
        with self._lock:
            return self._load().get(job_id)

    def create(self, work: AudioEnhancementWork, retry_of: str | None = None) -> AudioEnhancementJobInfo:
        with self._lock:
            request = work.request
            job = AudioEnhancementJobInfo(
                id=uuid4().hex,
                status=AudioEnhancementJobStatus.queued,
                input_id=request.input_id,
                source_file_name=request.source_file_name,
                source_file_size_bytes=work.file_size_bytes,
                backends=request.backends,
                preset=request.preset,
                retry_of=retry_of,
            )
            return self._save_job(job)

    def mark_running(self, job_id: str) -> AudioEnhancementJobInfo:
        with self._lock:
            job = self._require(job_id)
            if job.status == AudioEnhancementJobStatus.cancelled:
                return job
            return self._save_job(job.model_copy(update={
                "status": AudioEnhancementJobStatus.running,
                "stage": "preparing_audio",
                "progress_percent": 5,
                "started_at": utc_now(),
                "error": None,
            }))

    def report_progress(self, job_id: str, stage: str, progress_percent: int) -> AudioEnhancementJobInfo:
        with self._lock:
            job = self._require(job_id)
            if job.status != AudioEnhancementJobStatus.running:
                return job
            return self._save_job(job.model_copy(update={
                "stage": stage,
                "progress_percent": max(0, min(99, progress_percent)),
            }))

    def update_outputs(self, job_id: str, outputs: list[AudioEnhancementOutput]) -> AudioEnhancementJobInfo:
        with self._lock:
            job = self._require(job_id)
            if job.status == AudioEnhancementJobStatus.cancelled:
                return job
            return self._save_job(job.model_copy(update={"outputs": outputs}))

    def mark_completed(
        self,
        job_id: str,
        outputs: list[AudioEnhancementOutput],
        warnings: list[str] | None = None,
    ) -> AudioEnhancementJobInfo:
        with self._lock:
            job = self._require(job_id)
            if job.status == AudioEnhancementJobStatus.cancelled:
                return job
            return self._save_job(job.model_copy(update={
                "status": AudioEnhancementJobStatus.completed,
                "stage": "completed",
                "progress_percent": 100,
                "outputs": outputs,
                "warnings": warnings or [],
                "error": None,
                "completed_at": utc_now(),
            }))

    def mark_failed(self, job_id: str, error: Exception | str) -> AudioEnhancementJobInfo:
        with self._lock:
            job = self._require(job_id)
            if job.status == AudioEnhancementJobStatus.cancelled:
                return job
            return self._save_job(job.model_copy(update={
                "status": AudioEnhancementJobStatus.failed,
                "stage": "failed",
                "error": _safe_error(error),
                "completed_at": utc_now(),
            }))

    def cancel(self, job_id: str, force_running: bool = False) -> AudioEnhancementJobInfo:
        with self._lock:
            job = self._require(job_id)
            if job.status == AudioEnhancementJobStatus.cancelled:
                return job
            if job.status == AudioEnhancementJobStatus.running and not force_running:
                raise AudioEnhancementError("语音增强正在运行；请使用 force=true 终止当前本地模型任务。")
            if job.status not in {AudioEnhancementJobStatus.queued, AudioEnhancementJobStatus.running}:
                raise AudioEnhancementError("仅排队或运行中的语音增强任务可以取消。")
            return self._save_job(job.model_copy(update={
                "status": AudioEnhancementJobStatus.cancelled,
                "stage": "cancelled",
                "error": "用户取消了本地语音增强任务。",
                "completed_at": utc_now(),
            }))

    def recover_after_restart(self) -> None:
        with self._lock:
            jobs = self._load()
            changed = False
            for job_id, job in list(jobs.items()):
                if job.status not in {AudioEnhancementJobStatus.queued, AudioEnhancementJobStatus.running}:
                    continue
                jobs[job_id] = job.model_copy(update={
                    "status": AudioEnhancementJobStatus.failed,
                    "stage": "interrupted",
                    "error": "本地服务已重启；语音增强任务未完成，可使用重试继续。",
                    "completed_at": utc_now(),
                })
                changed = True
            if changed:
                self._save(jobs)

    def _require(self, job_id: str) -> AudioEnhancementJobInfo:
        job = self._load().get(job_id)
        if job is None:
            raise KeyError(job_id)
        return job

    def _save_job(self, job: AudioEnhancementJobInfo) -> AudioEnhancementJobInfo:
        jobs = self._load()
        jobs[job.id] = job
        self._save(jobs)
        return job

    def _load(self) -> dict[str, AudioEnhancementJobInfo]:
        if not self.jobs_file.is_file():
            return {}
        try:
            payload = json.loads(self.jobs_file.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return {}
        items = payload.get("audio_enhancements", []) if isinstance(payload, dict) else []
        jobs: dict[str, AudioEnhancementJobInfo] = {}
        for item in items:
            try:
                job = AudioEnhancementJobInfo.model_validate(item)
            except Exception:
                continue
            jobs[job.id] = job
        return jobs

    def _save(self, jobs: dict[str, AudioEnhancementJobInfo]) -> None:
        recent = sorted(jobs.values(), key=lambda job: job.created_at, reverse=True)[:MAX_STORED_AUDIO_ENHANCEMENT_JOBS]
        self.jobs_file.parent.mkdir(parents=True, exist_ok=True)
        temporary = self.jobs_file.with_suffix(".tmp")
        temporary.write_text(
            json.dumps({"audio_enhancements": [job.model_dump(mode="json") for job in recent]}, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        temporary.replace(self.jobs_file)


class AudioEnhancementRunner:
    def __init__(self, store: AudioEnhancementJobStore, settings: Settings):
        self.store = store
        self.settings = settings
        self._queue: queue.Queue[str] = queue.Queue()
        self._work: dict[str, AudioEnhancementWork] = {}
        self._processes: dict[str, subprocess.Popen[str]] = {}
        self._lock = threading.RLock()
        self._worker: threading.Thread | None = None
        self.store.recover_after_restart()

    def reconfigure(self, settings: Settings) -> None:
        with self._lock:
            self.settings = settings

    def enqueue(self, request: AudioEnhancementJobRequest, retry_of: str | None = None) -> AudioEnhancementJobInfo:
        work = _build_work(request, self.settings)
        job = self.store.create(work, retry_of=retry_of)
        with self._lock:
            self._work[job.id] = work
            self._queue.put(job.id)
            self._start_worker_if_needed()
        return self.store.get(job.id) or job

    def retry(self, job_id: str) -> AudioEnhancementJobInfo:
        job = self.store.get(job_id)
        if job is None:
            raise KeyError(job_id)
        if job.status not in {AudioEnhancementJobStatus.failed, AudioEnhancementJobStatus.cancelled}:
            raise AudioEnhancementError("仅失败或已取消的语音增强任务可以重试。")
        return self.enqueue(
            AudioEnhancementJobRequest(
                input_id=job.input_id,
                source_file_name=job.source_file_name,
                backends=job.backends,
                preset=job.preset,
            ),
            retry_of=job.id,
        )

    def cancel(self, job_id: str, force_running: bool = False) -> AudioEnhancementJobInfo:
        job = self.store.cancel(job_id, force_running=force_running)
        if force_running:
            with self._lock:
                process = self._processes.get(job_id)
                if process is not None and process.poll() is None:
                    process.terminate()
        return job

    def _start_worker_if_needed(self) -> None:
        if self._worker is None or not self._worker.is_alive():
            self._worker = threading.Thread(target=self._drain, name="open-tts-audio-enhancement-runner", daemon=True)
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
                if job is None or work is None or job.status == AudioEnhancementJobStatus.cancelled:
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

    def _run_work(self, job_id: str, work: AudioEnhancementWork) -> None:
        settings = self.settings
        if not settings.audio_enhancement_python.is_file():
            raise AudioEnhancementError("未找到语音增强 Python 运行时；请在设置中配置已安装 PyTorch、DeepFilterNet 与 ClearVoice 的 Python。")
        work_dir = settings.audio_enhancement_work_dir / job_id
        prepared_input = work_dir / "input-48k-mono.wav"
        work_dir.mkdir(parents=True, exist_ok=True)
        try:
            self.store.report_progress(job_id, "preparing_audio", 12)
            self._convert_to_canonical_wav(work.input_path, prepared_input, settings)
            sample_rate, duration_seconds = probe_audio_metadata(prepared_input, settings.ffmpeg_path)
            if duration_seconds <= 0:
                raise AudioEnhancementError("媒体音轨时长为零，无法进行语音增强。")

            outputs: list[AudioEnhancementOutput] = []
            with local_gpu_generation_lock:
                try:
                    release_conflicting_runtimes("audio_enhancement", settings)
                except RuntimeError as exc:
                    raise AudioEnhancementError(str(exc)) from exc
                total = len(work.request.backends)
                for index, backend in enumerate(work.request.backends, start=1):
                    _model_id, display_name = _BACKEND_MODELS[backend]
                    model_dir = _model_dir_for_backend(backend, settings)
                    start_progress = 20 + int((index - 1) / total * 70)
                    self.store.report_progress(job_id, f"running_{backend.value}", start_progress)
                    output_path = create_output_path(
                        settings.output_dir,
                        ".wav",
                        Path(work.request.source_file_name).stem,
                    )
                    self._run_backend(job_id, backend, prepared_input, output_path, model_dir, work.request.preset.value)
                    output_sample_rate, output_duration = probe_audio_metadata(output_path, settings.ffmpeg_path)
                    if output_duration <= 0:
                        raise AudioEnhancementError(f"{display_name} 没有生成有效音频。")
                    outputs.append(AudioEnhancementOutput(
                        backend=backend,
                        model=display_name,
                        audio_url=f"/outputs/{output_path.name}",
                        file_path=str(output_path),
                        sample_rate=output_sample_rate or sample_rate,
                        duration_seconds=output_duration,
                    ))
                    self.store.update_outputs(job_id, outputs)
            warnings = ["增强结果用于对比；音色克隆前建议优先试听轻度预设，避免过度处理改变音色。"]
            self.store.mark_completed(job_id, outputs, warnings=warnings)
        finally:
            shutil.rmtree(work_dir, ignore_errors=True)

    def _convert_to_canonical_wav(self, source: Path, destination: Path, settings: Settings) -> None:
        completed = subprocess.run(
            [
                settings.ffmpeg_path,
                "-nostdin",
                "-y",
                "-v",
                "error",
                "-i",
                str(source),
                "-vn",
                "-ac",
                "1",
                "-ar",
                "48000",
                "-c:a",
                "pcm_s16le",
                str(destination),
            ],
            check=False,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
        )
        if completed.returncode != 0 or not destination.is_file():
            raise AudioEnhancementError("无法将媒体转换为本地增强所需的 48 kHz WAV。")

    def _run_backend(
        self,
        job_id: str,
        backend: AudioEnhancementBackend,
        source: Path,
        destination: Path,
        model_dir: Path,
        preset: str,
    ) -> None:
        tool_path = Path(__file__).resolve().parents[1] / "tools" / "run_audio_enhancement.py"
        if not tool_path.is_file():
            raise AudioEnhancementError("语音增强运行脚本缺失，请修复本地安装。")
        command = [
            str(self.settings.audio_enhancement_python),
            str(tool_path),
            "--backend",
            backend.value,
            "--input",
            str(source),
            "--output",
            str(destination),
            "--model-dir",
            str(model_dir),
            "--preset",
            preset,
            "--device",
            self.settings.audio_enhancement_device,
        ]
        process = subprocess.Popen(
            command,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            errors="replace",
        )
        with self._lock:
            self._processes[job_id] = process
        stdout, stderr = process.communicate()
        if process.returncode != 0 or not destination.is_file():
            detail = _safe_error(stderr or stdout or "语音增强模型进程退出异常。")
            raise AudioEnhancementError(detail)


_stores: dict[str, AudioEnhancementJobStore] = {}
_runners: dict[str, AudioEnhancementRunner] = {}


def get_audio_enhancement_store(settings: Settings | None = None) -> AudioEnhancementJobStore:
    active = settings or get_settings()
    key = str(active.audio_enhancement_jobs_file)
    if key not in _stores:
        _stores[key] = AudioEnhancementJobStore(active.audio_enhancement_jobs_file)
    return _stores[key]


def get_audio_enhancement_runner(settings: Settings | None = None) -> AudioEnhancementRunner:
    active = settings or get_settings()
    key = str(active.audio_enhancement_jobs_file)
    if key not in _runners:
        _runners[key] = AudioEnhancementRunner(get_audio_enhancement_store(active), active)
    else:
        _runners[key].reconfigure(active)
    return _runners[key]
