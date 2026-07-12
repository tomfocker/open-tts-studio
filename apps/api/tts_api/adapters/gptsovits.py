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


class GptSoVitsServiceManager:
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
        return f"http://{self.settings.gptsovits_api_host}:{self.settings.gptsovits_api_port}"

    @property
    def python_executable(self) -> Path:
        return self.settings.gptsovits_root / "runtime" / "python.exe"

    @property
    def api_script(self) -> Path:
        return self.settings.gptsovits_root / "api_v2.py"

    @property
    def config_path(self) -> Path:
        return self.settings.gptsovits_root / "GPT_SoVITS" / "configs" / "tts_infer.yaml"

    def build_command(self) -> list[str]:
        return [
            str(self.python_executable),
            str(self.api_script),
            "-a",
            self.settings.gptsovits_api_host,
            "-p",
            str(self.settings.gptsovits_api_port),
            "-c",
            str(self.config_path),
        ]

    def build_environment(self) -> dict[str, str]:
        environment = os.environ.copy()
        root = self.settings.gptsovits_root
        runtime = root / "runtime"
        prepend_paths = [
            str(runtime),
            str(runtime / "Scripts"),
            str(runtime / "Lib" / "site-packages" / "torch" / "lib"),
            str(root),
            str(root / "GPT_SoVITS"),
        ]
        environment["PATH"] = os.pathsep.join(prepend_paths + [environment.get("PATH", "")])
        environment["PYTHONPATH"] = os.pathsep.join(
            [str(root), str(root / "GPT_SoVITS"), environment.get("PYTHONPATH", "")]
        )
        environment["HF_HOME"] = str(root / "models")
        environment["TORCH_HOME"] = str(root / "models")
        environment["MODELSCOPE_CACHE"] = str(root / "models")
        environment["PYTHONIOENCODING"] = "utf-8"
        return environment

    def is_healthy(self) -> bool:
        try:
            response = self.http_client.get(f"{self.api_base}/docs", timeout=2.0)
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
        raise TimeoutError("Timed out waiting for GPT-SoVITS API to become ready.")

    def start(self) -> None:
        if self.process is not None and self.process.poll() is None:
            return
        if not self.python_executable.exists():
            raise FileNotFoundError(f"GPT-SoVITS Python not found: {self.python_executable}")
        if not self.api_script.exists():
            raise FileNotFoundError(f"GPT-SoVITS API script not found: {self.api_script}")
        if not self.config_path.exists():
            raise FileNotFoundError(f"GPT-SoVITS config not found: {self.config_path}")

        self.process = self.popen(
            self.build_command(),
            cwd=str(self.settings.gptsovits_root),
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
            "model": "gptsovits",
            "loaded": healthy,
            "state": state,
            "api_base": self.api_base,
            "root": str(self.settings.gptsovits_root),
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


_service_managers: dict[tuple[str, int, str], GptSoVitsServiceManager] = {}


def get_gptsovits_service_manager(settings: Settings) -> GptSoVitsServiceManager:
    key = (settings.gptsovits_api_host, settings.gptsovits_api_port, str(settings.gptsovits_root))
    if key not in _service_managers:
        _service_managers[key] = GptSoVitsServiceManager(settings=settings)
    else:
        _service_managers[key].settings = settings
    return _service_managers[key]


def get_gptsovits_status(settings: Settings) -> dict:
    key = (settings.gptsovits_api_host, settings.gptsovits_api_port, str(settings.gptsovits_root))
    manager = _service_managers.get(key)
    if manager is None:
        return {
            "model": "gptsovits",
            "loaded": False,
            "state": "released",
            "api_base": f"http://{settings.gptsovits_api_host}:{settings.gptsovits_api_port}",
            "root": str(settings.gptsovits_root),
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


def shutdown_gptsovits_services() -> None:
    for manager in _service_managers.values():
        manager.shutdown()
    _service_managers.clear()


def release_gptsovits_service(settings: Settings) -> bool:
    key = (settings.gptsovits_api_host, settings.gptsovits_api_port, str(settings.gptsovits_root))
    manager = _service_managers.get(key)
    return manager.shutdown() if manager is not None else False


class GptSoVitsAdapter(TtsAdapter):
    def __init__(
        self,
        settings: Settings | None = None,
        http_client=httpx,
        service_manager=_DEFAULT_SERVICE_MANAGER,
    ):
        self.settings = settings or get_settings()
        self.http_client = http_client
        self.service_manager = (
            get_gptsovits_service_manager(self.settings)
            if service_manager is _DEFAULT_SERVICE_MANAGER
            else service_manager
        )

    @property
    def api_base(self) -> str:
        return f"http://{self.settings.gptsovits_api_host}:{self.settings.gptsovits_api_port}"

    def build_payload(self, request: SpeechRequest) -> dict:
        if not request.reference_audio:
            raise ValueError("GPT-SoVITS requires a reference audio file.")

        text_lang = self._normalize_language(request.language) or self._detect_language(request.input)
        prompt_text = request.reference_text or ""
        prompt_lang = self._detect_language(prompt_text, fallback=text_lang)
        return {
            "text": request.input,
            "text_lang": text_lang,
            "ref_audio_path": request.reference_audio,
            "prompt_text": prompt_text,
            "prompt_lang": prompt_lang,
            "text_split_method": "cut5",
            "batch_size": 1,
            "batch_threshold": 0.75,
            "split_bucket": True,
            "speed_factor": request.speed,
            "streaming_mode": False,
            "parallel_infer": True,
            "repetition_penalty": 1.35,
            "media_type": "wav",
        }

    def synthesize(self, request: SpeechRequest) -> SpeechResult:
        payload = self.build_payload(request)
        if self.service_manager is not None:
            self.service_manager.ensure_started()
            self.service_manager.begin_request()

        output_path = create_output_path(self.settings.output_dir, ".wav")
        try:
            response = self.http_client.post(f"{self.api_base}/tts", json=payload, timeout=600.0)
            response.raise_for_status()
        finally:
            if self.service_manager is not None:
                self.service_manager.finish_request()
        output_path.write_bytes(response.content)

        try:
            sample_rate, duration_seconds = read_wav_metadata(output_path)
        except Exception:
            sample_rate, duration_seconds = 32000, 0.0
        return SpeechResult(
            audio_url=f"/outputs/{output_path.name}",
            file_path=str(output_path),
            model=request.model,
            sample_rate=sample_rate,
            duration_seconds=duration_seconds,
        )

    def _normalize_language(self, language: str | None) -> str | None:
        if not language:
            return None
        normalized = language.lower().strip()
        if normalized.startswith("zh") or normalized in {"cn", "chinese"}:
            return "zh"
        if normalized.startswith("ja") or normalized in {"jp", "japanese"}:
            return "ja"
        if normalized.startswith("en") or normalized == "english":
            return "en"
        if normalized.startswith("ko") or normalized == "korean":
            return "ko"
        return normalized

    def _detect_language(self, text: str, fallback: str = "zh") -> str:
        if any("\u3040" <= char <= "\u30ff" for char in text):
            return "ja"
        if any("\u4e00" <= char <= "\u9fff" for char in text):
            return "zh"
        if any(("a" <= char.lower() <= "z") for char in text):
            return "en"
        return fallback
