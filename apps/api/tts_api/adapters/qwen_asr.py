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
from pathlib import Path
from typing import BinaryIO
from uuid import uuid4

from tts_api.config import Settings, get_settings


QWEN_ASR_WORKER = Path(__file__).resolve().parents[2] / "tools" / "run_qwen_asr.py"


class QwenASRTranscriber:
    model_name = "qwen3-asr-1.7b"
    runtime_model_id = "qwen3-asr"

    def __init__(self, settings: Settings | None = None):
        self.settings = settings or get_settings()

    def transcribe_path(self, audio_path: Path, language: str = "zh") -> str:
        if not audio_path.is_file():
            raise FileNotFoundError("本地音频不存在，无法使用 Qwen3-ASR 转写。")
        self._validate_runtime()
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
                    "device": self.settings.qwen_asr_device,
                    "ffmpeg_path": self.settings.ffmpeg_path,
                },
                ensure_ascii=False,
            ),
            encoding="utf-8",
        )
        try:
            try:
                completed = subprocess.run(
                    [str(self.settings.qwen_asr_python), str(QWEN_ASR_WORKER), "--request", str(request_path), "--output", str(response_path)],
                    cwd=str(QWEN_ASR_WORKER.parent),
                    stdin=subprocess.DEVNULL,
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                    check=False,
                    timeout=self.settings.qwen_asr_timeout_seconds,
                    env=self._environment(),
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

    def _validate_runtime(self) -> None:
        if not self.settings.qwen_asr_python.is_file():
            raise FileNotFoundError("Qwen3-ASR Python 运行时不存在；请配置 OPEN_TTS_QWEN_ASR_PYTHON。")
        if not self.settings.qwen_asr_capswriter_root or not self.settings.qwen_asr_capswriter_root.is_dir():
            raise FileNotFoundError("Qwen3-ASR 引擎目录未配置；请配置 OPEN_TTS_QWEN_ASR_CAPSWRITER_ROOT。")
        if not self.settings.qwen_asr_model_dir.is_dir():
            raise FileNotFoundError("Qwen3-ASR 模型目录不存在；请配置 OPEN_TTS_QWEN_ASR_MODEL_DIR。")
        if not QWEN_ASR_WORKER.is_file():
            raise FileNotFoundError("OpenTTS Qwen3-ASR 识别脚本不存在。")

    def _environment(self) -> dict[str, str]:
        environment = os.environ.copy()
        environment.update(
            {
                "HF_HUB_OFFLINE": "1",
                "TRANSFORMERS_OFFLINE": "1",
                "HF_HUB_DISABLE_TELEMETRY": "1",
                "PYTHONUTF8": "1",
            }
        )
        return environment
