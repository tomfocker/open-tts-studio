"""Lifecycle and protocol adapter for Whispera's upstream streaming VoxCPM service.

The model implementation lives unchanged in ``vendor/whispera_voxcpm``.  This
module intentionally contains only OpenTTS-specific process management and
protocol conversion, keeping the regular VoxCPM2 HTTP service untouched.
"""

from __future__ import annotations

import asyncio
import base64
import contextlib
import json
import os
import subprocess
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import AsyncIterator
from uuid import uuid4

import httpx
import numpy as np
import websockets

from tts_api.config import Settings, get_settings


class WhisperaStreamingUnavailable(RuntimeError):
    """The optional upstream streaming worker could not be prepared."""


class WhisperaStreamingGenerationError(RuntimeError):
    """The upstream worker accepted a request but could not synthesize it."""


@dataclass(frozen=True)
class WhisperaPcmChunk:
    sample_rate: int
    samples: np.ndarray


class WhisperaStreamingServiceManager:
    """Start Whispera's existing WebSocket service inside the VoxCPM2 runtime."""

    def __init__(
        self,
        settings: Settings | None = None,
        popen=subprocess.Popen,
        http_client=httpx,
        startup_timeout_seconds: float = 20.0,
        timer_factory=threading.Timer,
        now_factory=time.time,
        sleep=time.sleep,
    ):
        self.settings = settings or get_settings()
        self.popen = popen
        self.http_client = http_client
        self.startup_timeout_seconds = startup_timeout_seconds
        self.timer_factory = timer_factory
        self.now_factory = now_factory
        self.sleep = sleep
        self.process: subprocess.Popen | None = None
        self.started_at: float | None = None
        self.last_used_at: float | None = None
        self.active_requests = 0
        self._idle_timer = None
        self._lock = threading.Lock()
        self._process_log_handle = None

    @property
    def api_base(self) -> str:
        return f"http://{self.settings.voxcpm2_streaming_api_host}:{self.settings.voxcpm2_streaming_api_port}"

    @property
    def websocket_url(self) -> str:
        return f"ws://{self.settings.voxcpm2_streaming_api_host}:{self.settings.voxcpm2_streaming_api_port}/ws/tts"

    @property
    def python_executable(self) -> Path:
        return self.settings.voxcpm2_root / "MWAI" / "python.exe"

    @property
    def source_path(self) -> Path:
        return self.settings.workspace_root / "apps" / "api" / "vendor" / "whispera_voxcpm" / "src"

    @property
    def websocket_support_path(self) -> Path:
        return self.settings.workspace_root / "apps" / "api" / "vendor" / "whispera_voxcpm" / "support"

    @property
    def model_path(self) -> Path:
        preferred = self.settings.voxcpm2_root / "models" / "openbmb__VoxCPM2"
        if preferred.is_dir():
            return preferred
        if (self.settings.voxcpm2_root / "config.json").is_file():
            return self.settings.voxcpm2_root
        raise FileNotFoundError(
            "未找到 Whispera 流式 TTS 所需的 VoxCPM2 权重目录："
            f"{preferred}"
        )

    @property
    def log_path(self) -> Path:
        return self.settings.task_log_dir.parent / "models" / "whispera-voxcpm-streaming.log"

    def build_environment(self) -> dict[str, str]:
        if not (self.source_path / "voxcpm" / "streaming_service.py").is_file():
            raise FileNotFoundError(f"Whispera 流式模块不存在：{self.source_path}")
        if not (self.websocket_support_path / "websockets" / "__init__.py").is_file():
            raise FileNotFoundError(f"Whispera WebSocket 运行时不存在：{self.websocket_support_path}")

        environment = os.environ.copy()
        root = self.settings.voxcpm2_root
        python_root = root / "MWAI"
        prepend_paths = [
            str(python_root / "Lib" / "site-packages" / "torch" / "lib"),
            str(python_root / "Scripts"),
            str(python_root / "ffmpeg" / "bin"),
        ]
        environment["PATH"] = os.pathsep.join(prepend_paths + [environment.get("PATH", "")])
        environment["HF_HOME"] = str(root / "models")
        environment["TORCH_HOME"] = str(root / "models")
        environment["MODELSCOPE_CACHE"] = str(root)
        environment["HF_HUB_OFFLINE"] = "1"
        environment["TRANSFORMERS_OFFLINE"] = "1"
        environment["PYTHONIOENCODING"] = "utf-8"
        # The model runtime has FastAPI/Uvicorn but no websocket backend. Both
        # path entries are vendored pure-Python source and leave the model pack
        # itself unmodified.
        python_paths = [str(self.source_path), str(self.websocket_support_path)]
        if existing := environment.get("PYTHONPATH"):
            python_paths.append(existing)
        environment["PYTHONPATH"] = os.pathsep.join(python_paths)
        return environment

    def is_healthy(self, timeout_seconds: float = 1.0) -> bool:
        try:
            response = self.http_client.get(f"{self.api_base}/health", timeout=timeout_seconds)
            response.raise_for_status()
            payload = response.json()
            return bool(isinstance(payload, dict) and payload.get("websocket_path") == "/ws/tts")
        except Exception:
            return False

    def ensure_started(self) -> None:
        if self.is_healthy():
            return
        if self.process is None or self.process.poll() is not None:
            self.start()
        deadline = time.monotonic() + self.startup_timeout_seconds
        while time.monotonic() < deadline:
            if self.is_healthy():
                return
            if self.process is not None and self.process.poll() is not None:
                raise WhisperaStreamingUnavailable("Whispera 流式 TTS 服务在启动时异常退出。")
            self.sleep(0.25)
        raise WhisperaStreamingUnavailable("Whispera 流式 TTS 服务启动超时；请查看模型日志。")

    def start(self) -> None:
        if self.process is not None and self.process.poll() is None:
            return
        if not self.python_executable.exists():
            raise FileNotFoundError(f"VoxCPM2 Python 不存在：{self.python_executable}")
        self.model_path  # Validate eagerly so error arrives before a subprocess starts.

        self.log_path.parent.mkdir(parents=True, exist_ok=True)
        self._close_process_log()
        self._process_log_handle = self.log_path.open("a", encoding="utf-8")
        try:
            self.process = self.popen(
                [
                    str(self.python_executable),
                    "-m",
                    "voxcpm.streaming_service",
                    "--host",
                    self.settings.voxcpm2_streaming_api_host,
                    "--port",
                    str(self.settings.voxcpm2_streaming_api_port),
                    "--model-path",
                    str(self.model_path),
                    "--local-files-only",
                    "--log-level",
                    "warning",
                ],
                cwd=str(self.settings.voxcpm2_root),
                env=self.build_environment(),
                stdin=subprocess.DEVNULL,
                stdout=self._process_log_handle,
                stderr=subprocess.STDOUT,
                text=True,
            )
        except Exception:
            self._close_process_log()
            raise
        self.started_at = self.now_factory()
        self.last_used_at = self.started_at
        self._schedule_idle_release()

    def begin_request(self) -> None:
        with self._lock:
            self.active_requests += 1
            self._cancel_idle_release()

    def finish_request(self) -> None:
        with self._lock:
            self.active_requests = max(0, self.active_requests - 1)
            self.last_used_at = self.now_factory()
            self._schedule_idle_release()

    def status(self) -> dict:
        managed = self.process is not None and self.process.poll() is None
        idle_seconds = int(self.now_factory() - self.last_used_at) if self.last_used_at else None
        return {
            "model": "whispera-voxcpm-streaming",
            "loaded": managed,
            "state": "loaded" if managed else "released",
            "api_base": self.api_base,
            "websocket_url": self.websocket_url,
            "last_started_at": self.started_at,
            "last_used_at": self.last_used_at,
            "idle_timeout_seconds": self.settings.local_api_idle_timeout_seconds,
            "idle_seconds": idle_seconds,
            "managed": managed,
            "can_stop": managed and self.active_requests == 0,
            "active_requests": self.active_requests,
        }

    def shutdown(self, force: bool = False) -> bool:
        self._cancel_idle_release()
        if self.process is None or self.process.poll() is not None:
            self._close_process_log()
            return False
        if self.active_requests > 0 and not force:
            return False
        process = self.process
        try:
            process.terminate()
            if force:
                wait = getattr(process, "wait", None)
                if callable(wait):
                    wait(timeout=5)
        except Exception:
            if force:
                with contextlib.suppress(Exception):
                    process.kill()
        finally:
            self.process = None
            self.last_used_at = None
            if force:
                self.active_requests = 0
            self._close_process_log()
        return True

    def _close_process_log(self) -> None:
        if self._process_log_handle is not None:
            self._process_log_handle.close()
            self._process_log_handle = None

    def _cancel_idle_release(self) -> None:
        if self._idle_timer is not None:
            self._idle_timer.cancel()
            self._idle_timer = None

    def _schedule_idle_release(self) -> None:
        timeout_seconds = self.settings.local_api_idle_timeout_seconds
        if timeout_seconds <= 0 or self.process is None or self.process.poll() is not None:
            return
        self._cancel_idle_release()
        self._idle_timer = self.timer_factory(timeout_seconds, self._release_if_idle)
        self._idle_timer.daemon = True
        self._idle_timer.start()

    def _release_if_idle(self) -> None:
        with self._lock:
            if self.active_requests > 0:
                self._schedule_idle_release()
                return
            if self.last_used_at is None:
                return
            if self.now_factory() - self.last_used_at < self.settings.local_api_idle_timeout_seconds:
                self._schedule_idle_release()
                return
            self.shutdown()


_service_managers: dict[tuple[str, int, str], WhisperaStreamingServiceManager] = {}


def get_whispera_streaming_service_manager(settings: Settings) -> WhisperaStreamingServiceManager:
    key = (
        settings.voxcpm2_streaming_api_host,
        settings.voxcpm2_streaming_api_port,
        str(settings.voxcpm2_root),
    )
    if key not in _service_managers:
        _service_managers[key] = WhisperaStreamingServiceManager(settings=settings)
    else:
        _service_managers[key].settings = settings
    return _service_managers[key]


def get_whispera_streaming_status(settings: Settings) -> dict:
    manager = _service_managers.get(
        (settings.voxcpm2_streaming_api_host, settings.voxcpm2_streaming_api_port, str(settings.voxcpm2_root))
    )
    if manager is None:
        return {
            "model": "whispera-voxcpm-streaming",
            "loaded": False,
            "state": "released",
            "api_base": f"http://{settings.voxcpm2_streaming_api_host}:{settings.voxcpm2_streaming_api_port}",
            "websocket_url": f"ws://{settings.voxcpm2_streaming_api_host}:{settings.voxcpm2_streaming_api_port}/ws/tts",
            "managed": False,
            "can_stop": False,
            "active_requests": 0,
        }
    return manager.status()


def release_whispera_streaming_service(settings: Settings, force: bool = False) -> bool:
    manager = _service_managers.get(
        (settings.voxcpm2_streaming_api_host, settings.voxcpm2_streaming_api_port, str(settings.voxcpm2_root))
    )
    return manager.shutdown(force=force) if manager is not None else False


def shutdown_whispera_streaming_services() -> None:
    for manager in _service_managers.values():
        manager.shutdown(force=True)
    _service_managers.clear()


async def stream_whispera_tts(
    settings: Settings,
    *,
    text: str,
    reference_audio: str | None,
    reference_text: str | None,
    cancel_event: asyncio.Event,
) -> AsyncIterator[WhisperaPcmChunk]:
    """Yield Whispera PCM chunks and forward cancellation to its WS protocol."""
    manager = get_whispera_streaming_service_manager(settings)
    try:
        await asyncio.to_thread(manager.ensure_started)
    except Exception as exc:
        raise WhisperaStreamingUnavailable(str(exc)) from exc

    manager.begin_request()
    session_id = f"opentts-{uuid4().hex}"
    request_id = f"tts-{uuid4().hex}"
    started = False
    interrupt_sent = False
    sample_rate = 0
    try:
        try:
            async with websockets.connect(manager.websocket_url, open_timeout=8, close_timeout=2, max_size=None) as websocket:
                ready = json.loads(await asyncio.wait_for(websocket.recv(), timeout=8))
                if ready.get("type") != "server.ready":
                    raise WhisperaStreamingUnavailable("Whispera 流式 TTS 未返回 server.ready。")
                await websocket.send(json.dumps({"type": "session.start", "session_id": session_id}))
                session_ready = json.loads(await asyncio.wait_for(websocket.recv(), timeout=8))
                if session_ready.get("type") != "session.ready":
                    raise WhisperaStreamingUnavailable("Whispera 流式 TTS 未建立会话。")
                await websocket.send(
                    json.dumps(
                        {
                            "type": "tts.start",
                            "session_id": session_id,
                            "request_id": request_id,
                            "text": text,
                            "prompt_audio_path": reference_audio,
                            "prompt_text": reference_text,
                            "cfg_value": 2.0,
                            "inference_timesteps": 10,
                            "normalize": True,
                            "denoise": False,
                        }
                    )
                )

                while True:
                    if cancel_event.is_set() and not interrupt_sent:
                        interrupt_sent = True
                        await websocket.send(
                            json.dumps(
                                {
                                    "type": "tts.interrupt",
                                    "session_id": session_id,
                                    "request_id": f"interrupt-{uuid4().hex}",
                                }
                            )
                        )
                    if cancel_event.is_set() and interrupt_sent:
                        # Whispera marks the request interrupted immediately,
                        # but its current generator can still be inside one
                        # non-preemptible CUDA step.  This managed process is
                        # dedicated to realtime streaming, so force-stopping
                        # it here is the only reliable way to release the
                        # shared GPU slot before the queued ASR/new turn uses
                        # it.  An externally managed service is never killed.
                        await asyncio.to_thread(manager.shutdown, True)
                        return
                    try:
                        raw_message = await asyncio.wait_for(websocket.recv(), timeout=0.1)
                    except TimeoutError:
                        continue
                    message = json.loads(raw_message)
                    message_type = message.get("type")
                    if message_type == "tts.started":
                        started = True
                        sample_rate = int(message.get("sample_rate") or 0)
                        if sample_rate <= 0:
                            raise WhisperaStreamingGenerationError("Whispera 流式 TTS 未提供有效采样率。")
                        continue
                    if message_type == "tts.chunk":
                        encoded = message.get("data")
                        if not isinstance(encoded, str):
                            raise WhisperaStreamingGenerationError("Whispera 流式 TTS 返回了无效音频块。")
                        samples = np.frombuffer(base64.b64decode(encoded), dtype=np.float32).copy()
                        if samples.size:
                            yield WhisperaPcmChunk(sample_rate=sample_rate, samples=samples)
                        continue
                    if message_type == "tts.completed":
                        return
                    if message_type == "error":
                        error = str(message.get("message") or "Whispera 流式 TTS 生成失败。")
                        if started:
                            raise WhisperaStreamingGenerationError(error)
                        raise WhisperaStreamingUnavailable(error)
        except WhisperaStreamingUnavailable:
            raise
        except WhisperaStreamingGenerationError:
            raise
        except Exception as exc:
            error_type = WhisperaStreamingGenerationError if started else WhisperaStreamingUnavailable
            raise error_type(f"Whispera 流式 TTS 连接失败：{exc}") from exc
    finally:
        manager.finish_request()
