"""Independent lifecycle manager and client for local SenseVoice ASR.

The service shares neither a process nor an HTTP endpoint with VoxCPM2.  It
may use a pre-existing compatible Python runtime during migration, but all
paths are explicit SenseVoice settings so any TTS package can be removed or
replaced without changing ASR behaviour.
"""

from __future__ import annotations

import os
import subprocess
import threading
import time
from pathlib import Path
from typing import BinaryIO, Callable

import httpx

from tts_api.config import Settings, get_settings


SENSEVOICE_SERVER = Path(__file__).resolve().parents[2] / "tools" / "sensevoice_asr_server.py"


class SenseVoiceServiceManager:
    def __init__(
        self,
        settings: Settings | None = None,
        popen: Callable[..., subprocess.Popen] = subprocess.Popen,
        http_client=httpx,
        startup_timeout_seconds: float = 90.0,
        timer_factory: Callable[[float, Callable[[], None]], threading.Timer] = threading.Timer,
        now_factory: Callable[[], float] = time.time,
        sleep: Callable[[float], None] = time.sleep,
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
        return f"http://{self.settings.sensevoice_api_host}:{self.settings.sensevoice_api_port}"

    @property
    def python_executable(self) -> Path:
        return self.settings.sensevoice_python

    @property
    def log_path(self) -> Path:
        return self.settings.task_log_dir.parent / "models" / "sensevoice.log"

    @property
    def work_dir(self) -> Path:
        return self.settings.output_dir.parent / "asr" / "sensevoice-work"

    def build_environment(self) -> dict[str, str]:
        environment = os.environ.copy()
        runtime_root = self.python_executable.parent
        prepend_paths = [
            str(runtime_root / "Lib" / "site-packages" / "torch" / "lib"),
            str(runtime_root / "Scripts"),
            str(runtime_root / "ffmpeg" / "bin"),
        ]
        environment["PATH"] = os.pathsep.join(prepend_paths + [environment.get("PATH", "")])
        environment.update(
            {
                "HF_HUB_OFFLINE": "1",
                "TRANSFORMERS_OFFLINE": "1",
                "HF_HUB_DISABLE_TELEMETRY": "1",
                "MODELSCOPE_OFFLINE": "1",
                "PYTHONIOENCODING": "utf-8",
                "PYTHONUTF8": "1",
            }
        )
        return environment

    def is_healthy(self, timeout_seconds: float = 2.0) -> bool:
        try:
            response = self.http_client.get(f"{self.api_base}/health", timeout=timeout_seconds)
            response.raise_for_status()
            payload = response.json()
            return bool(isinstance(payload, dict) and payload.get("status") == "ok" and payload.get("model_loaded"))
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
                raise RuntimeError("独立 SenseVoice 服务在模型加载时异常退出。")
            self.sleep(0.2)
        raise TimeoutError("独立 SenseVoice 服务启动超时；请检查本地运行时与模型目录。")

    def start(self) -> None:
        if self.process is not None and self.process.poll() is None:
            return
        if not self.python_executable.is_file():
            raise FileNotFoundError("SenseVoice Python 运行时不存在；请配置 OPEN_TTS_SENSEVOICE_PYTHON。")
        if not self.settings.sensevoice_model_dir.is_dir():
            raise FileNotFoundError("SenseVoice 本地模型目录不存在；请配置 OPEN_TTS_SENSEVOICE_MODEL_DIR。")
        if not SENSEVOICE_SERVER.is_file():
            raise FileNotFoundError("OpenTTS SenseVoice 服务脚本不存在。")

        self.log_path.parent.mkdir(parents=True, exist_ok=True)
        self.work_dir.mkdir(parents=True, exist_ok=True)
        self._close_process_log()
        self._process_log_handle = self.log_path.open("a", encoding="utf-8")
        try:
            self.process = self.popen(
                [
                    str(self.python_executable),
                    str(SENSEVOICE_SERVER),
                    "--host",
                    self.settings.sensevoice_api_host,
                    "--port",
                    str(self.settings.sensevoice_api_port),
                    "--model-dir",
                    str(self.settings.sensevoice_model_dir),
                    "--device",
                    self.settings.sensevoice_device,
                    "--work-dir",
                    str(self.work_dir),
                ],
                cwd=str(SENSEVOICE_SERVER.parent),
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

    def status(self, probe_timeout_seconds: float | None = None) -> dict:
        managed = self.process is not None and self.process.poll() is None
        healthy = self.is_healthy(probe_timeout_seconds) if probe_timeout_seconds is not None else None
        idle_seconds = int(self.now_factory() - self.last_used_at) if self.last_used_at else None
        if healthy is True:
            state = "loaded" if managed else "external"
        elif managed:
            state = "unresponsive" if self.active_requests else "starting"
        else:
            state = "released"
        timeout = self.settings.sensevoice_idle_timeout_seconds
        return {
            "model": "sensevoice",
            "backend": "sensevoice-small",
            "loaded": managed if healthy is None else healthy,
            "state": state,
            "health": "ok" if healthy is True else "unresponsive" if healthy is False else "not_checked",
            "api_base": self.api_base,
            "model_dir": str(self.settings.sensevoice_model_dir),
            "last_started_at": self.started_at,
            "last_used_at": self.last_used_at,
            "idle_timeout_seconds": timeout,
            "idle_seconds": idle_seconds,
            "release_in_seconds": max(0, timeout - idle_seconds) if managed and idle_seconds is not None else None,
            "managed": managed,
            "can_stop": managed and self.active_requests == 0,
            "active_requests": self.active_requests,
        }

    def shutdown(self) -> bool:
        self._cancel_idle_release()
        if self.process is None or self.process.poll() is not None:
            self._close_process_log()
            return False
        if self.active_requests:
            return False
        self.process.terminate()
        self.process = None
        self.last_used_at = None
        self._close_process_log()
        return True

    def force_shutdown(self) -> bool:
        self._cancel_idle_release()
        process = self.process
        if process is None or process.poll() is not None:
            self._close_process_log()
            return False
        try:
            process.terminate()
            wait = getattr(process, "wait", None)
            if callable(wait):
                wait(timeout=5)
        except Exception:
            kill = getattr(process, "kill", None)
            if callable(kill):
                try:
                    kill()
                except Exception:
                    pass
        finally:
            self.process = None
            self.last_used_at = None
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
        timeout = self.settings.sensevoice_idle_timeout_seconds
        if timeout <= 0 or self.process is None or self.process.poll() is not None:
            return
        self._cancel_idle_release()
        self._idle_timer = self.timer_factory(timeout, self._release_if_idle)
        self._idle_timer.daemon = True
        self._idle_timer.start()

    def _release_if_idle(self) -> None:
        with self._lock:
            if self.active_requests:
                self._schedule_idle_release()
                return
            if self.last_used_at is None:
                return
            if self.now_factory() - self.last_used_at < self.settings.sensevoice_idle_timeout_seconds:
                self._schedule_idle_release()
                return
            self.shutdown()


_service_managers: dict[tuple[str, int, str, str], SenseVoiceServiceManager] = {}


def _key(settings: Settings) -> tuple[str, int, str, str]:
    return (
        settings.sensevoice_api_host,
        settings.sensevoice_api_port,
        str(settings.sensevoice_python),
        str(settings.sensevoice_model_dir),
    )


def get_sensevoice_service_manager(settings: Settings | None = None) -> SenseVoiceServiceManager:
    active_settings = settings or get_settings()
    key = _key(active_settings)
    if key not in _service_managers:
        _service_managers[key] = SenseVoiceServiceManager(settings=active_settings)
    else:
        _service_managers[key].settings = active_settings
    return _service_managers[key]


def get_sensevoice_status(settings: Settings | None = None, probe_timeout_seconds: float | None = None) -> dict:
    active_settings = settings or get_settings()
    manager = _service_managers.get(_key(active_settings))
    if manager is None:
        return {
            "model": "sensevoice",
            "backend": "sensevoice-small",
            "loaded": False,
            "state": "released",
            "api_base": f"http://{active_settings.sensevoice_api_host}:{active_settings.sensevoice_api_port}",
            "model_dir": str(active_settings.sensevoice_model_dir),
            "last_started_at": None,
            "last_used_at": None,
            "idle_timeout_seconds": active_settings.sensevoice_idle_timeout_seconds,
            "idle_seconds": None,
            "release_in_seconds": None,
            "managed": False,
            "can_stop": False,
            "active_requests": 0,
        }
    return manager.status(probe_timeout_seconds=probe_timeout_seconds)


def shutdown_sensevoice_services() -> None:
    for manager in _service_managers.values():
        manager.shutdown()
    _service_managers.clear()


def release_sensevoice_service(settings: Settings | None = None, force: bool = False) -> bool:
    active_settings = settings or get_settings()
    manager = _service_managers.get(_key(active_settings))
    if manager is None:
        return False
    return manager.force_shutdown() if force else manager.shutdown()


class SenseVoiceTranscriber:
    """The public/private client used by alignment and audio-transcription APIs."""

    model_name = "sensevoice-small"
    runtime_model_id = "sensevoice"

    def __init__(
        self,
        settings: Settings | None = None,
        http_client=httpx,
        request_timeout_seconds: float = 120.0,
        service_manager: SenseVoiceServiceManager | None = None,
    ):
        self.settings = settings or get_settings()
        self.http_client = http_client
        self.request_timeout_seconds = request_timeout_seconds
        self.service_manager = service_manager or get_sensevoice_service_manager(self.settings)

    def transcribe_path(self, audio_path: Path, language: str = "zh") -> str:
        if not audio_path.is_file():
            raise FileNotFoundError("最终音频不存在，无法进行本地 ASR 校验。")
        with audio_path.open("rb") as audio:
            return self._transcribe_stream(audio, audio_path.name, language)

    def transcribe_upload(self, stream: BinaryIO, filename: str, language: str = "zh") -> str:
        return self._transcribe_stream(stream, filename or "audio.wav", language)

    def _transcribe_stream(self, stream: BinaryIO, filename: str, language: str) -> str:
        self.service_manager.ensure_started()
        self.service_manager.begin_request()
        try:
            response = self.http_client.post(
                f"{self.service_manager.api_base}/transcribe",
                data={"language": language, "use_itn": "true"},
                files={"audio": (Path(filename).name, stream, "application/octet-stream")},
                timeout=self.request_timeout_seconds,
            )
            response.raise_for_status()
            payload = response.json()
            text = payload.get("text") if isinstance(payload, dict) else None
            if not isinstance(text, str) or not text.strip():
                raise RuntimeError("本地 SenseVoice 未返回可用文本。")
            return text.strip()
        except httpx.TimeoutException as exc:
            self.service_manager.force_shutdown()
            raise RuntimeError("本地 SenseVoice ASR 超时，已停止无响应的 ASR 服务。") from exc
        except httpx.HTTPError as exc:
            raise RuntimeError("本地 SenseVoice ASR 未能识别最终音频。") from exc
        finally:
            self.service_manager.finish_request()
