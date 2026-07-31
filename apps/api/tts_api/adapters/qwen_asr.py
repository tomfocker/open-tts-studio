"""One-shot, fully local Qwen3-ASR transcription adapter.

This is deliberately a separate ASR backend, not a dependency of TTS or the
post-synthesis forced-alignment worker.  A short-lived child process prevents
CapsWriter's native ONNX/llama runtime from leaking into the desktop API
process and releases its VRAM after each recognition request.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import tempfile
import time
from dataclasses import dataclass
from pathlib import Path
from typing import BinaryIO, Callable
from uuid import uuid4

from tts_api.config import Settings, get_settings
from tts_api.qwen_runtime import QwenRuntimeError, ResolvedQwenRuntime, qwen_worker_environment, resolve_qwen_runtime


QWEN_ASR_WORKER = Path(__file__).resolve().parents[2] / "tools" / "run_qwen_asr.py"
QWEN_TIMESTAMPED_ASR_WORKER = Path(__file__).resolve().parents[2] / "tools" / "run_qwen_timestamped_asr.py"


@dataclass(frozen=True)
class TimestampedQwenTranscription:
    text: str
    raw_text: str
    tokens: list[str]
    timestamps: list[float]
    duration_seconds: float
    language: str
    model: str


class QwenASRTranscriber:
    model_name = "qwen3-asr-1.7b"
    runtime_model_id = "qwen3-asr"

    def __init__(self, settings: Settings | None = None):
        self.settings = settings or get_settings()

    def _runtime(self) -> ResolvedQwenRuntime:
        try:
            return resolve_qwen_runtime(self.settings, self.settings.qwen_asr_device)
        except QwenRuntimeError as exc:
            raise RuntimeError(str(exc)) from exc

    def transcribe_path(self, audio_path: Path, language: str = "zh") -> str:
        if not audio_path.is_file():
            raise FileNotFoundError("本地音频不存在，无法使用 Qwen3-ASR 转写。")
        # The child worker runs from ``apps/api/tools``.  Preserve the caller's
        # media location rather than interpreting a relative path from there.
        audio_path = audio_path.resolve()
        runtime = self._runtime()
        self._validate_runtime(runtime)
        self.settings.qwen_asr_work_dir.mkdir(parents=True, exist_ok=True)
        request_path = self.settings.qwen_asr_work_dir / f"{uuid4().hex}.request.json"
        response_path = self.settings.qwen_asr_work_dir / f"{uuid4().hex}.response.json"
        request_path.write_text(
            json.dumps(
                {
                    "audio_path": str(audio_path),
                    "language": language,
                    "capswriter_root": str(self.settings.qwen_asr_capswriter_root),
                    "model_dir": str(self.settings.qwen_asr_model_dir),
                    "active_device": runtime.active_device,
                    "onnx_provider": runtime.onnx_provider,
                    "llm_use_gpu": runtime.llm_use_gpu,
                    "cuda_backend_dir": str(runtime.llama_backend_dir or ""),
                    "ffmpeg_path": self.settings.ffmpeg_path,
                },
                ensure_ascii=False,
            ),
            encoding="utf-8",
        )
        try:
            try:
                completed = subprocess.run(
                    [str(runtime.python_executable), str(QWEN_ASR_WORKER), "--request", str(request_path), "--output", str(response_path)],
                    cwd=str(QWEN_ASR_WORKER.parent),
                    stdin=subprocess.DEVNULL,
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                    check=False,
                    timeout=self.settings.qwen_asr_timeout_seconds,
                    env=self._environment(runtime),
                )
            except subprocess.TimeoutExpired as exc:
                raise RuntimeError("本地 Qwen3-ASR 转写超时，已终止识别进程。") from exc
            except OSError as exc:
                raise RuntimeError("无法启动本地 Qwen3-ASR 进程；请检查运行时配置。") from exc
            payload = json.loads(response_path.read_text(encoding="utf-8")) if response_path.is_file() else None
            if isinstance(payload, dict) and payload.get("ok"):
                result = payload.get("result")
                text = result.get("text") if isinstance(result, dict) else None
                if isinstance(text, str) and text.strip():
                    return text.strip()
                raise RuntimeError("本地 Qwen3-ASR 未返回可用文本。")
            if isinstance(payload, dict):
                error = payload.get("error")
                if isinstance(error, dict) and isinstance(error.get("message"), str):
                    raise RuntimeError(error["message"])
            if completed.returncode != 0:
                raise RuntimeError("本地 Qwen3-ASR 进程失败；请检查模型和运行时配置。")
            raise RuntimeError("本地 Qwen3-ASR 未产生结果。")
        finally:
            for path in (request_path, response_path):
                try:
                    path.unlink(missing_ok=True)
                except OSError:
                    pass

    def transcribe_upload(self, stream: BinaryIO, filename: str, language: str = "zh") -> str:
        self.settings.qwen_asr_work_dir.mkdir(parents=True, exist_ok=True)
        suffix = Path(filename or "audio.bin").suffix[:16] or ".bin"
        temporary_path: Path | None = None
        try:
            with tempfile.NamedTemporaryFile(dir=self.settings.qwen_asr_work_dir, suffix=suffix, delete=False) as temporary:
                temporary_path = Path(temporary.name)
                shutil.copyfileobj(stream, temporary)
            return self.transcribe_path(temporary_path, language=language)
        finally:
            if temporary_path is not None:
                try:
                    temporary_path.unlink(missing_ok=True)
                except OSError:
                    pass

    def transcribe_timestamped_path(
        self,
        audio_path: Path,
        language: str = "zh",
        on_process: Callable[[subprocess.Popen], None] | None = None,
    ) -> TimestampedQwenTranscription:
        """Recognize a controlled local media file and return real token starts.

        Subtitle generation intentionally requires the paired ForcedAligner.
        A plain ASR transcript is never converted to made-up cue timings.
        """

        if not audio_path.is_file():
            raise FileNotFoundError("本地音视频不存在，无法生成真实字幕时间轴。")
        audio_path = audio_path.resolve()
        runtime = self._runtime()
        self._validate_timestamped_runtime(runtime)
        self.settings.qwen_asr_work_dir.mkdir(parents=True, exist_ok=True)
        request_path = self.settings.qwen_asr_work_dir / f"{uuid4().hex}.timestamped.request.json"
        response_path = self.settings.qwen_asr_work_dir / f"{uuid4().hex}.timestamped.response.json"
        request_path.write_text(
            json.dumps(
                {
                    "audio_path": str(audio_path),
                    "language": language,
                    "capswriter_root": str(self.settings.qwen_asr_capswriter_root),
                    "model_dir": str(self.settings.qwen_asr_model_dir),
                    "aligner_model_dir": str(self.settings.alignment_aligner_model_dir or ""),
                    "active_device": runtime.active_device,
                    "onnx_provider": runtime.onnx_provider,
                    "llm_use_gpu": runtime.llm_use_gpu,
                    "cuda_backend_dir": str(runtime.llama_backend_dir or ""),
                    "ffmpeg_path": self.settings.ffmpeg_path,
                    "chunk_size": 60,
                    "chunk_overlap": 5,
                },
                ensure_ascii=False,
            ),
            encoding="utf-8",
        )
        try:
            process: subprocess.Popen | None = None
            try:
                process = subprocess.Popen(
                    [str(runtime.python_executable), str(QWEN_TIMESTAMPED_ASR_WORKER), "--request", str(request_path), "--output", str(response_path)],
                    cwd=str(QWEN_TIMESTAMPED_ASR_WORKER.parent),
                    stdin=subprocess.DEVNULL,
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                    env=self._environment(runtime),
                )
                if on_process:
                    on_process(process)
                deadline = time.monotonic() + self.settings.qwen_asr_timeout_seconds
                while process.poll() is None:
                    if time.monotonic() >= deadline:
                        process.terminate()
                        raise RuntimeError("本地 Qwen3 字幕时间轴生成超时，已终止识别进程。")
                    time.sleep(0.05)
                completed_returncode = process.returncode
            except OSError as exc:
                raise RuntimeError("无法启动本地 Qwen3 字幕进程；请检查运行时配置。") from exc
            payload = json.loads(response_path.read_text(encoding="utf-8")) if response_path.is_file() else None
            if isinstance(payload, dict) and payload.get("ok") and isinstance(payload.get("result"), dict):
                result = payload["result"]
                text = result.get("text")
                tokens = result.get("tokens")
                timestamps = result.get("timestamps")
                duration = result.get("duration_seconds")
                if (
                    isinstance(text, str)
                    and text.strip()
                    and isinstance(tokens, list)
                    and isinstance(timestamps, list)
                    and len(tokens) == len(timestamps)
                    and tokens
                    and isinstance(duration, (int, float))
                    and duration > 0
                ):
                    token_pairs = [(str(token), float(timestamp)) for token, timestamp in zip(tokens, timestamps) if str(token)]
                    if not token_pairs:
                        raise RuntimeError("本地 Qwen3 未返回可用的字幕 token。")
                    return TimestampedQwenTranscription(
                        text=text.strip(),
                        raw_text=str(result.get("raw_text") or text).strip(),
                        tokens=[token for token, _timestamp in token_pairs],
                        timestamps=[timestamp for _token, timestamp in token_pairs],
                        duration_seconds=float(duration),
                        language=str(result.get("language") or language),
                        model=str(result.get("model") or "qwen3-asr-1.7b+qwen3-forced-aligner-0.6b"),
                    )
                raise RuntimeError("本地 Qwen3 未返回完整的真实字幕时间轴。")
            if isinstance(payload, dict):
                error = payload.get("error")
                if isinstance(error, dict) and isinstance(error.get("message"), str):
                    raise RuntimeError(error["message"])
            if completed_returncode != 0:
                raise RuntimeError("本地 Qwen3 字幕进程失败；请检查模型和运行时配置。")
            raise RuntimeError("本地 Qwen3 字幕进程未产生结果。")
        finally:
            for path in (request_path, response_path):
                try:
                    path.unlink(missing_ok=True)
                except OSError:
                    pass

    def _validate_runtime(self, runtime: ResolvedQwenRuntime) -> None:
        if not runtime.python_executable.is_file():
            raise FileNotFoundError("Qwen3-ASR Python 运行时不存在；请检查本地 Qwen 设备运行时。")
        if not self.settings.qwen_asr_capswriter_root or not self.settings.qwen_asr_capswriter_root.is_dir():
            raise FileNotFoundError("Qwen3-ASR 引擎目录未配置；请配置 OPEN_TTS_QWEN_ASR_CAPSWRITER_ROOT。")
        if not self.settings.qwen_asr_model_dir.is_dir():
            raise FileNotFoundError("Qwen3-ASR 模型目录不存在；请配置 OPEN_TTS_QWEN_ASR_MODEL_DIR。")
        if not QWEN_ASR_WORKER.is_file():
            raise FileNotFoundError("OpenTTS Qwen3-ASR 识别脚本不存在。")

    def _validate_timestamped_runtime(self, runtime: ResolvedQwenRuntime) -> None:
        self._validate_runtime(runtime)
        if not self.settings.alignment_aligner_model_dir or not self.settings.alignment_aligner_model_dir.is_dir():
            raise FileNotFoundError("Qwen3-ForcedAligner 模型不存在；真实 SRT 需要先安装该本地模型。")
        if not QWEN_TIMESTAMPED_ASR_WORKER.is_file():
            raise FileNotFoundError("OpenTTS Qwen3 字幕时间轴脚本不存在。")

    def _environment(self, runtime: ResolvedQwenRuntime) -> dict[str, str]:
        environment = os.environ.copy()
        environment.update(
            {
                "HF_HUB_OFFLINE": "1",
                "TRANSFORMERS_OFFLINE": "1",
                "HF_HUB_DISABLE_TELEMETRY": "1",
                "PYTHONUTF8": "1",
            }
        )
        return qwen_worker_environment(runtime, environment)
