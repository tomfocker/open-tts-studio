"""Managed, fully local two-stem MDX-Net separation jobs.

The API process remains free of PyTorch/ONNX separation imports.  A small
worker in an opt-in runtime loads the already-downloaded UVR-compatible ONNX
models, while this module owns safe media staging, serial GPU access, durable
job state, cancellation and output publication.
"""

from __future__ import annotations

import json
import os
import queue
import re
import shutil
import subprocess
import threading
from dataclasses import dataclass
from datetime import datetime, timezone
from enum import StrEnum
from pathlib import Path
from uuid import uuid4

from pydantic import BaseModel, Field

from tts_api.audio import create_output_path, probe_audio_metadata
from tts_api.config import Settings, get_settings
from tts_api.runtime_memory import local_gpu_generation_lock, release_conflicting_runtimes


MAX_STORED_AUDIO_SEPARATION_JOBS = 200
_INPUT_ID_RE = re.compile(r"^[a-f0-9]{32}$")
_DRIVE_PATH_RE = re.compile(r"[A-Za-z]:[\\/][^\s]+")


class AudioSeparationError(RuntimeError):
    """A safe, user-visible local audio-separation failure."""


class AudioSeparationModel(StrEnum):
    mdx_vocals = "mdx-vocals"
    mdx_karaoke = "mdx-karaoke"
    mdx23c_instvoc_hq = "mdx23c-instvoc-hq"


class AudioSeparationStatus(StrEnum):
    queued = "queued"
    running = "running"
    completed = "completed"
    failed = "failed"
    cancelled = "cancelled"


class AudioSeparationInputInfo(BaseModel):
    """An opaque file key; callers never supply a local source path."""

    id: str = Field(min_length=8, max_length=128)
    file_name: str = Field(min_length=1, max_length=255)
    file_size_bytes: int = Field(ge=0)


class AudioSeparationJobRequest(BaseModel):
    input_id: str = Field(min_length=8, max_length=128)
    source_file_name: str = Field(min_length=1, max_length=255)
    model: AudioSeparationModel = AudioSeparationModel.mdx_vocals


class AudioSeparationOutput(BaseModel):
    stem: str = Field(pattern=r"^(vocals|instrumental)$")
    audio_url: str
    file_path: str
    sample_rate: int = Field(ge=1)
    duration_seconds: float = Field(ge=0)


class AudioSeparationJobInfo(BaseModel):
    id: str
    status: AudioSeparationStatus
    input_id: str
    source_file_name: str
    source_file_size_bytes: int = Field(ge=0)
    model: AudioSeparationModel
    model_display_name: str
    stage: str = "queued"
    progress_percent: int = Field(default=0, ge=0, le=100)
    outputs: list[AudioSeparationOutput] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    error: str | None = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    started_at: datetime | None = None
    completed_at: datetime | None = None
    retry_of: str | None = None


@dataclass(frozen=True)
class _Paths:
    root: Path
    inputs: Path
    work: Path
    jobs_file: Path


@dataclass(frozen=True)
class _ModelSpec:
    file_name: str
    display_name: str
    detail: str
    backend: str
    config_name: str | None = None


@dataclass(frozen=True)
class _Work:
    request: AudioSeparationJobRequest
    input_path: Path
    file_size_bytes: int


_MODEL_SPECS = {
    AudioSeparationModel.mdx_vocals: _ModelSpec(
        file_name="UVR-MDX-NET-Voc_FT.onnx",
        display_name="UVR-MDX-NET Vocals FT",
        detail="人声主输出；适合提取干声。",
        backend="mdx",
    ),
    AudioSeparationModel.mdx_karaoke: _ModelSpec(
        file_name="UVR_MDXNET_KARA_2.onnx",
        display_name="UVR-MDX-NET Karaoke 2",
        detail="伴奏主输出；适合去人声与卡拉 OK。",
        backend="mdx",
    ),
    AudioSeparationModel.mdx23c_instvoc_hq: _ModelSpec(
        file_name="MDX23C-8KFFT-InstVoc_HQ.ckpt",
        display_name="MDX23C-InstVoc HQ",
        detail="高质量两轨；复杂混音中通常更干净，但运行时间和显存占用更高。",
        backend="mdxc",
        config_name="model_2_stem_full_band_8k.yaml",
    ),
}


def _paths(settings: Settings) -> _Paths:
    explicit = os.environ.get("OPEN_TTS_AUDIO_SEPARATION_ROOT", "").strip()
    root = Path(explicit) if explicit else settings.output_dir.parent / "audio-separations"
    return _Paths(root=root, inputs=root / "inputs", work=root / "work", jobs_file=root / "jobs.json")


def _runtime_python(settings: Settings | None = None) -> Path:
    configured = os.environ.get("OPEN_TTS_AUDIO_SEPARATION_PYTHON", "").strip()
    if configured:
        return Path(configured)
    return (settings or get_settings()).audio_separation_python


def _model_root(settings: Settings | None = None) -> Path:
    configured = os.environ.get("OPEN_TTS_MDX_MODEL_ROOT", "").strip()
    return Path(configured) if configured else (settings or get_settings()).audio_separation_root


def _safe_error(error: Exception | str) -> str:
    value = str(error).replace("\r", " ").replace("\n", " ").strip()
    value = _DRIVE_PATH_RE.sub("<本地路径>", value)
    return value[:1000] or "本地音频分轨失败。"


def _safe_file_name(value: str) -> str:
    name = Path(value or "").name
    if not name or name != value or any(character in name for character in ("\x00", "\r", "\n")):
        raise AudioSeparationError("媒体文件名无效。")
    return name


def _managed_input_path(input_id: str, settings: Settings) -> Path:
    if not _INPUT_ID_RE.fullmatch(input_id):
        raise AudioSeparationError("媒体导入标识无效，请重新选择本地文件。")
    candidates = [path for path in _paths(settings).inputs.glob(f"{input_id}.*") if path.is_file()]
    candidates = [path for path in candidates if path.suffix.lower() not in {".json", ".tmp", ".part"}]
    if len(candidates) != 1:
        raise AudioSeparationError("找不到受控的媒体导入文件，请重新选择本地文件。")
    return candidates[0]


def _build_work(request: AudioSeparationJobRequest, settings: Settings) -> _Work:
    source_file_name = _safe_file_name(request.source_file_name)
    source = _managed_input_path(request.input_id, settings)
    try:
        file_size_bytes = source.stat().st_size
    except OSError as exc:
        raise AudioSeparationError("无法读取受控的媒体导入文件。") from exc
    if file_size_bytes <= 0 or file_size_bytes > settings.transcription_max_input_bytes:
        raise AudioSeparationError("媒体文件为空或超过本地分轨允许的大小。")
    return _Work(request=request.model_copy(update={"source_file_name": source_file_name}), input_path=source, file_size_bytes=file_size_bytes)


def _model_files(model: AudioSeparationModel, settings: Settings | None = None) -> tuple[_ModelSpec, Path, Path]:
    spec = _MODEL_SPECS[model]
    root = _model_root(settings)
    model_file = root / spec.file_name
    model_config = (
        root / "model_data" / "mdx_c_configs" / spec.config_name
        if spec.config_name
        else root / "model_data" / "model_data.json"
    )
    if not model_file.is_file() or not model_config.is_file():
        raise AudioSeparationError(f"{spec.display_name} 模型包不完整；请选择包含 {spec.file_name} 与所需 model_data 的目录。")
    return spec, model_file, model_config


class AudioSeparationJobStore:
    def __init__(self, jobs_file: Path):
        self.jobs_file = jobs_file
        self._lock = threading.RLock()

    def list(self, limit: int = 100) -> list[AudioSeparationJobInfo]:
        with self._lock:
            return sorted(self._load().values(), key=lambda job: job.created_at, reverse=True)[:limit]

    def get(self, job_id: str) -> AudioSeparationJobInfo | None:
        with self._lock:
            return self._load().get(job_id)

    def create(self, work: _Work, retry_of: str | None = None) -> AudioSeparationJobInfo:
        with self._lock:
            spec = _MODEL_SPECS[work.request.model]
            job = AudioSeparationJobInfo(
                id=uuid4().hex,
                status=AudioSeparationStatus.queued,
                input_id=work.request.input_id,
                source_file_name=work.request.source_file_name,
                source_file_size_bytes=work.file_size_bytes,
                model=work.request.model,
                model_display_name=spec.display_name,
                retry_of=retry_of,
            )
            return self._save_job(job)

    def mark_running(self, job_id: str) -> AudioSeparationJobInfo:
        return self._update(job_id, status=AudioSeparationStatus.running, stage="preparing_audio", progress_percent=5, started_at=datetime.now(timezone.utc), error=None)

    def report_progress(self, job_id: str, stage: str, progress_percent: int) -> AudioSeparationJobInfo:
        with self._lock:
            job = self._require(job_id)
            if job.status != AudioSeparationStatus.running:
                return job
            return self._save_job(job.model_copy(update={"stage": stage, "progress_percent": max(0, min(99, progress_percent))}))

    def mark_completed(self, job_id: str, outputs: list[AudioSeparationOutput], warnings: list[str]) -> AudioSeparationJobInfo:
        return self._update(job_id, status=AudioSeparationStatus.completed, stage="completed", progress_percent=100, outputs=outputs, warnings=warnings, error=None, completed_at=datetime.now(timezone.utc))

    def mark_failed(self, job_id: str, error: Exception | str) -> AudioSeparationJobInfo:
        with self._lock:
            job = self._require(job_id)
            if job.status == AudioSeparationStatus.cancelled:
                return job
            return self._save_job(job.model_copy(update={"status": AudioSeparationStatus.failed, "stage": "failed", "error": _safe_error(error), "completed_at": datetime.now(timezone.utc)}))

    def cancel(self, job_id: str, force_running: bool = False) -> AudioSeparationJobInfo:
        with self._lock:
            job = self._require(job_id)
            if job.status == AudioSeparationStatus.cancelled:
                return job
            if job.status == AudioSeparationStatus.running and not force_running:
                raise AudioSeparationError("音频分轨正在运行；请使用 force=true 终止当前本地模型任务。")
            if job.status not in {AudioSeparationStatus.queued, AudioSeparationStatus.running}:
                raise AudioSeparationError("仅排队或运行中的音频分轨任务可以取消。")
            return self._save_job(job.model_copy(update={"status": AudioSeparationStatus.cancelled, "stage": "cancelled", "error": "用户取消了本地音频分轨任务。", "completed_at": datetime.now(timezone.utc)}))

    def recover_after_restart(self) -> None:
        with self._lock:
            jobs = self._load()
            changed = False
            for job_id, job in list(jobs.items()):
                if job.status in {AudioSeparationStatus.queued, AudioSeparationStatus.running}:
                    jobs[job_id] = job.model_copy(update={"status": AudioSeparationStatus.failed, "stage": "interrupted", "error": "本地服务已重启；分轨任务未完成，可使用重试继续。", "completed_at": datetime.now(timezone.utc)})
                    changed = True
            if changed:
                self._save(jobs)

    def _update(self, job_id: str, **changes: object) -> AudioSeparationJobInfo:
        with self._lock:
            job = self._require(job_id)
            if job.status == AudioSeparationStatus.cancelled and changes.get("status") != AudioSeparationStatus.cancelled:
                return job
            return self._save_job(job.model_copy(update=changes))

    def _require(self, job_id: str) -> AudioSeparationJobInfo:
        job = self._load().get(job_id)
        if job is None:
            raise KeyError(job_id)
        return job

    def _save_job(self, job: AudioSeparationJobInfo) -> AudioSeparationJobInfo:
        jobs = self._load()
        jobs[job.id] = job
        self._save(jobs)
        return job

    def _load(self) -> dict[str, AudioSeparationJobInfo]:
        if not self.jobs_file.is_file():
            return {}
        try:
            payload = json.loads(self.jobs_file.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return {}
        items = payload.get("audio_separations", []) if isinstance(payload, dict) else []
        jobs: dict[str, AudioSeparationJobInfo] = {}
        for item in items:
            try:
                job = AudioSeparationJobInfo.model_validate(item)
            except Exception:
                continue
            jobs[job.id] = job
        return jobs

    def _save(self, jobs: dict[str, AudioSeparationJobInfo]) -> None:
        recent = sorted(jobs.values(), key=lambda job: job.created_at, reverse=True)[:MAX_STORED_AUDIO_SEPARATION_JOBS]
        self.jobs_file.parent.mkdir(parents=True, exist_ok=True)
        temporary = self.jobs_file.with_suffix(".tmp")
        temporary.write_text(json.dumps({"audio_separations": [job.model_dump(mode="json") for job in recent]}, ensure_ascii=False, indent=2), encoding="utf-8")
        temporary.replace(self.jobs_file)


class AudioSeparationRunner:
    def __init__(self, store: AudioSeparationJobStore, settings: Settings):
        self.store = store
        self.settings = settings
        self._queue: queue.Queue[str] = queue.Queue()
        self._work: dict[str, _Work] = {}
        self._processes: dict[str, subprocess.Popen[str]] = {}
        self._lock = threading.RLock()
        self._worker: threading.Thread | None = None
        self.store.recover_after_restart()

    def reconfigure(self, settings: Settings) -> None:
        with self._lock:
            self.settings = settings

    def enqueue(self, request: AudioSeparationJobRequest, retry_of: str | None = None) -> AudioSeparationJobInfo:
        work = _build_work(request, self.settings)
        _model_files(work.request.model, self.settings)
        job = self.store.create(work, retry_of=retry_of)
        with self._lock:
            self._work[job.id] = work
            self._queue.put(job.id)
            self._start_worker_if_needed()
        return self.store.get(job.id) or job

    def retry(self, job_id: str) -> AudioSeparationJobInfo:
        job = self.store.get(job_id)
        if job is None:
            raise KeyError(job_id)
        if job.status not in {AudioSeparationStatus.failed, AudioSeparationStatus.cancelled}:
            raise AudioSeparationError("仅失败或已取消的音频分轨任务可以重试。")
        return self.enqueue(AudioSeparationJobRequest(input_id=job.input_id, source_file_name=job.source_file_name, model=job.model), retry_of=job.id)

    def cancel(self, job_id: str, force_running: bool = False) -> AudioSeparationJobInfo:
        job = self.store.cancel(job_id, force_running=force_running)
        if force_running:
            with self._lock:
                process = self._processes.get(job_id)
                if process is not None and process.poll() is None:
                    process.terminate()
        return job

    def _start_worker_if_needed(self) -> None:
        if self._worker is None or not self._worker.is_alive():
            self._worker = threading.Thread(target=self._drain, name="open-tts-audio-separation-runner", daemon=True)
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
                if job is None or work is None or job.status == AudioSeparationStatus.cancelled:
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

    def _run_work(self, job_id: str, work: _Work) -> None:
        runtime = _runtime_python(self.settings)
        if not runtime.is_file():
            raise AudioSeparationError("未找到音频分轨 Python 运行时；请安装本地 audio-separation-runtime。")
        settings = self.settings
        paths = _paths(settings)
        work_dir = paths.work / job_id
        canonical = work_dir / "input-44k-stereo.wav"
        generated_dir = work_dir / "generated"
        work_dir.mkdir(parents=True, exist_ok=True)
        try:
            self.store.report_progress(job_id, "preparing_audio", 12)
            self._convert_to_canonical_wav(work.input_path, canonical)
            source_rate, duration_seconds = probe_audio_metadata(canonical, settings.ffmpeg_path)
            if duration_seconds <= 0:
                raise AudioSeparationError("媒体音轨时长为零，无法进行人声与伴奏分离。")
            spec, model_file, model_config = _model_files(work.request.model, settings)
            self.store.report_progress(job_id, "waiting_for_gpu", 20)
            with local_gpu_generation_lock:
                try:
                    release_conflicting_runtimes("audio_separation", settings)
                except RuntimeError as exc:
                    raise AudioSeparationError(str(exc)) from exc
                self.store.report_progress(job_id, "running_mdx_net", 32)
                stems = self._run_model(job_id, canonical, generated_dir, spec.backend, model_file, model_config)
            self.store.report_progress(job_id, "publishing_outputs", 90)
            outputs = self._publish_outputs(work, stems, source_rate)
            if len(outputs) != 2:
                raise AudioSeparationError("分轨结果不完整，未生成有效的人声与伴奏文件。")
            self.store.mark_completed(job_id, outputs, warnings=[f"{spec.detail} 分离结果为本地生成；复杂混响、合唱与现场录音可能仍有串音。"])
        finally:
            shutil.rmtree(work_dir, ignore_errors=True)

    def _convert_to_canonical_wav(self, source: Path, destination: Path) -> None:
        completed = subprocess.run([
            self.settings.ffmpeg_path, "-nostdin", "-y", "-v", "error", "-i", str(source), "-vn", "-ac", "2", "-ar", "44100", "-c:a", "pcm_s16le", str(destination),
        ], check=False, capture_output=True, text=True, encoding="utf-8", errors="replace")
        if completed.returncode != 0 or not destination.is_file():
            raise AudioSeparationError("无法将媒体转换为 MDX-Net 所需的 44.1 kHz 立体声 WAV。")

    def _run_model(self, job_id: str, source: Path, output_dir: Path, backend: str, model_file: Path, model_config: Path) -> dict[str, Path]:
        worker = Path(__file__).resolve().parents[1] / "tools" / "run_audio_separation.py"
        if not worker.is_file():
            raise AudioSeparationError("音频分轨运行脚本缺失，请修复本地安装。")
        command = [str(_runtime_python(self.settings)), str(worker), "--backend", backend, "--input", str(source), "--output-dir", str(output_dir), "--model-file", str(model_file), "--model-config", str(model_config), "--device", self.settings.audio_separation_device]
        process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding="utf-8", errors="replace")
        with self._lock:
            self._processes[job_id] = process
        stdout, stderr = process.communicate()
        if process.returncode != 0:
            raise AudioSeparationError(_safe_error(stderr or stdout or "音频分轨模型进程退出异常。"))
        payload = next((line for line in reversed(stdout.splitlines()) if line.lstrip().startswith("{")), "")
        try:
            stems = json.loads(payload).get("stems", {})
        except json.JSONDecodeError as exc:
            raise AudioSeparationError("音频分轨模型未返回有效结果。") from exc
        resolved: dict[str, Path] = {}
        output_root = output_dir.resolve()
        for stem in ("vocals", "instrumental"):
            candidate = Path(str(stems.get(stem, "")))
            try:
                candidate.resolve().relative_to(output_root)
            except ValueError as exc:
                raise AudioSeparationError("音频分轨模型返回了无效输出路径。") from exc
            if candidate.is_file() and candidate.stat().st_size > 0:
                resolved[stem] = candidate
        return resolved

    def _publish_outputs(self, work: _Work, stems: dict[str, Path], source_rate: int) -> list[AudioSeparationOutput]:
        outputs: list[AudioSeparationOutput] = []
        for stem in ("vocals", "instrumental"):
            generated = stems.get(stem)
            if generated is None:
                continue
            output = create_output_path(self.settings.output_dir, ".wav", Path(work.request.source_file_name).stem)
            shutil.move(str(generated), output)
            sample_rate, duration_seconds = probe_audio_metadata(output, self.settings.ffmpeg_path)
            if duration_seconds <= 0:
                output.unlink(missing_ok=True)
                continue
            outputs.append(AudioSeparationOutput(stem=stem, audio_url=f"/outputs/{output.name}", file_path=str(output), sample_rate=sample_rate or source_rate, duration_seconds=duration_seconds))
        return outputs


_stores: dict[str, AudioSeparationJobStore] = {}
_runners: dict[str, AudioSeparationRunner] = {}


def get_audio_separation_store(settings: Settings | None = None) -> AudioSeparationJobStore:
    active = settings or get_settings()
    path = _paths(active).jobs_file
    key = str(path)
    if key not in _stores:
        _stores[key] = AudioSeparationJobStore(path)
    return _stores[key]


def get_audio_separation_runner(settings: Settings | None = None) -> AudioSeparationRunner:
    active = settings or get_settings()
    key = str(_paths(active).jobs_file)
    if key not in _runners:
        _runners[key] = AudioSeparationRunner(get_audio_separation_store(active), active)
    else:
        _runners[key].reconfigure(active)
    return _runners[key]
