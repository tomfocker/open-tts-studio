import os
import subprocess
import threading
import time
from pathlib import Path
from typing import Callable

import httpx

from tts_api.adapters.base import TtsAdapter
from tts_api.audio import create_output_path, read_wav_metadata
from tts_api.config import Settings, get_settings
from tts_api.schemas import SpeechRequest, SpeechResult


_DEFAULT_SERVICE_MANAGER = object()


class VoxCpm2ServiceManager:
    def __init__(
        self,
        settings: Settings | None = None,
        popen: Callable[..., subprocess.Popen] = subprocess.Popen,
        http_client=httpx,
        startup_timeout_seconds: float = 240.0,
        timer_factory: Callable[[float, Callable[[], None]], threading.Timer] = threading.Timer,
        now_factory: Callable[[], float] = time.time,
    ):
        self.settings = settings or get_settings()
        self.popen = popen
        self.http_client = http_client
        self.startup_timeout_seconds = startup_timeout_seconds
        self.timer_factory = timer_factory
        self.now_factory = now_factory
        self.process: subprocess.Popen | None = None
        self.started_at: float | None = None
        self.last_used_at: float | None = None
        self.active_requests = 0
        self._idle_timer = None
        self._lock = threading.Lock()

    @property
    def api_base(self) -> str:
        return f"http://{self.settings.voxcpm2_api_host}:{self.settings.voxcpm2_api_port}"

    @property
    def python_executable(self) -> Path:
        return self.settings.voxcpm2_root / "MWAI" / "python.exe"

    @property
    def api_script(self) -> Path:
        return self.settings.voxcpm2_root / "api.py"

    def build_environment(self) -> dict[str, str]:
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
        environment["OPEN_TTS_VOXCPM2_API_PORT"] = str(self.settings.voxcpm2_api_port)
        return environment

    def is_healthy(self) -> bool:
        try:
            response = self.http_client.get(f"{self.api_base}/health", timeout=2.0)
            response.raise_for_status()
            return True
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
            time.sleep(0.8)
        raise TimeoutError("Timed out waiting for VoxCPM2 API to become ready.")

    def start(self) -> None:
        if self.process is not None and self.process.poll() is None:
            return
        if not self.python_executable.exists():
            raise FileNotFoundError(f"VoxCPM2 Python not found: {self.python_executable}")
        if not self.api_script.exists():
            raise FileNotFoundError(f"VoxCPM2 API script not found: {self.api_script}")

        self.process = self.popen(
            [
                str(self.python_executable),
                "-m",
                "uvicorn",
                "api:app",
                "--host",
                self.settings.voxcpm2_api_host,
                "--port",
                str(self.settings.voxcpm2_api_port),
            ],
            cwd=str(self.settings.voxcpm2_root),
            env=self.build_environment(),
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            text=True,
        )
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
        healthy = self.is_healthy()
        managed = self.process is not None and self.process.poll() is None
        idle_timeout = self.settings.local_api_idle_timeout_seconds
        idle_seconds = int(self.now_factory() - self.last_used_at) if self.last_used_at else None
        if healthy:
            state = "loaded" if managed else "external"
        else:
            state = "starting" if managed else "released"
        return {
            "model": "voxcpm2",
            "loaded": healthy,
            "state": state,
            "api_base": self.api_base,
            "root": str(self.settings.voxcpm2_root),
            "last_started_at": self.started_at,
            "last_used_at": self.last_used_at,
            "idle_timeout_seconds": idle_timeout,
            "idle_seconds": idle_seconds,
            "release_in_seconds": max(0, idle_timeout - idle_seconds) if managed and idle_seconds is not None else None,
            "managed": managed,
            "can_stop": managed and self.active_requests == 0,
            "active_requests": self.active_requests,
        }

    def shutdown(self) -> bool:
        self._cancel_idle_release()
        if self.process is None or self.process.poll() is not None:
            return False
        if self.active_requests > 0:
            return False
        self.process.terminate()
        self.process = None
        self.last_used_at = None
        return True

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


_service_managers: dict[tuple[str, int, str], VoxCpm2ServiceManager] = {}


def get_voxcpm2_service_manager(settings: Settings) -> VoxCpm2ServiceManager:
    key = (settings.voxcpm2_api_host, settings.voxcpm2_api_port, str(settings.voxcpm2_root))
    if key not in _service_managers:
        _service_managers[key] = VoxCpm2ServiceManager(settings=settings)
    else:
        _service_managers[key].settings = settings
    return _service_managers[key]


def get_voxcpm2_status(settings: Settings) -> dict:
    key = (settings.voxcpm2_api_host, settings.voxcpm2_api_port, str(settings.voxcpm2_root))
    manager = _service_managers.get(key)
    if manager is None:
        return {
            "model": "voxcpm2",
            "loaded": False,
            "state": "released",
            "api_base": f"http://{settings.voxcpm2_api_host}:{settings.voxcpm2_api_port}",
            "root": str(settings.voxcpm2_root),
            "last_started_at": None,
            "last_used_at": None,
            "idle_timeout_seconds": settings.local_api_idle_timeout_seconds,
            "idle_seconds": None,
            "release_in_seconds": None,
            "managed": False,
            "can_stop": False,
            "active_requests": 0,
        }
    return manager.status()


def shutdown_voxcpm2_services() -> None:
    for manager in _service_managers.values():
        manager.shutdown()
    _service_managers.clear()


def release_voxcpm2_service(settings: Settings) -> bool:
    key = (settings.voxcpm2_api_host, settings.voxcpm2_api_port, str(settings.voxcpm2_root))
    manager = _service_managers.get(key)
    return manager.shutdown() if manager is not None else False


class VoxCpm2Adapter(TtsAdapter):
    def __init__(
        self,
        settings: Settings | None = None,
        python_executable: str = "python",
        http_client=httpx,
        service_manager=_DEFAULT_SERVICE_MANAGER,
    ):
        self.settings = settings or get_settings()
        self.python_executable = python_executable
        self.http_client = http_client
        self.service_manager = (
            get_voxcpm2_service_manager(self.settings)
            if service_manager is _DEFAULT_SERVICE_MANAGER
            else service_manager
        )

    @property
    def api_base(self) -> str:
        return f"http://{self.settings.voxcpm2_api_host}:{self.settings.voxcpm2_api_port}"

    def build_command(self, request: SpeechRequest) -> tuple[list[str], Path]:
        output_path = create_output_path(self.settings.output_dir, ".wav")
        command = [
            self.python_executable,
            "tools/run_voxcpm2.py",
            "--text",
            request.input,
            "--output",
            str(output_path),
        ]
        if request.voice_prompt:
            command.extend(["--voice-prompt", request.voice_prompt])
        if request.reference_audio:
            command.extend(["--reference-audio", request.reference_audio])
        if request.reference_text:
            command.extend(["--reference-text", request.reference_text])
        return command, output_path

    def synthesize(self, request: SpeechRequest) -> SpeechResult:
        if self.service_manager is not None:
            self.service_manager.ensure_started()
            self.service_manager.begin_request()

        output_path = create_output_path(self.settings.output_dir, ".wav")
        data = {
            "text": request.input,
            "control_instruction": request.emotion or request.voice_prompt or "",
            "prompt_text": request.reference_text,
            "cfg_value": "2.0",
            "inference_timesteps": "10",
            "normalize": "true",
            "denoise": "true",
        }
        files = None
        file_handle = None
        try:
            if request.reference_audio:
                reference_path = Path(request.reference_audio)
                file_handle = reference_path.open("rb")
                files = {"prompt_audio": (reference_path.name, file_handle, "audio/wav")}
            response = self.http_client.post(
                f"{self.api_base}/tts",
                data=data,
                files=files,
                timeout=600.0,
            )
            response.raise_for_status()
        finally:
            if file_handle is not None:
                file_handle.close()
            if self.service_manager is not None:
                self.service_manager.finish_request()

        output_path.write_bytes(response.content)
        try:
            sample_rate, duration_seconds = read_wav_metadata(output_path)
        except Exception:
            sample_rate, duration_seconds = 48000, 0.0
        return SpeechResult(
            audio_url=f"/outputs/{output_path.name}",
            file_path=str(output_path),
            model=request.model,
            sample_rate=sample_rate,
            duration_seconds=duration_seconds,
        )
