import json
import os
import queue
import subprocess
import threading
import time
from pathlib import Path
from typing import Callable, TextIO

from tts_api.config import Settings, get_settings
from tts_api.schemas import SpeechRequest


class IndexTts2WorkerClient:
    def __init__(
        self,
        settings: Settings | None = None,
        python_executable: str | None = None,
        popen: Callable[..., subprocess.Popen] = subprocess.Popen,
        timer_factory: Callable[[float, Callable[[], None]], threading.Timer] = threading.Timer,
        now_factory: Callable[[], float] = time.time,
        ready_timeout_seconds: float = 180.0,
        request_timeout_seconds: float = 300.0,
    ):
        self.settings = settings or get_settings()
        self.lazy_pack_root = self.settings.indextts2_root
        self.python_executable = python_executable or str(self.python_dir / "python.exe")
        self.popen = popen
        self.timer_factory = timer_factory
        self.now_factory = now_factory
        self.ready_timeout_seconds = ready_timeout_seconds
        self.request_timeout_seconds = request_timeout_seconds
        self.process = None
        self._stdout_queue: queue.Queue[str] = queue.Queue()
        self._reader_thread: threading.Thread | None = None
        self._lock = threading.Lock()
        self._idle_timer = None
        self.last_used_at: float | None = None
        self.last_started_at: float | None = None

    @property
    def python_dir(self) -> Path:
        return self.lazy_pack_root / "WPy64-310110" / "python-3.10.11.amd64"

    @property
    def ffmpeg_dir(self) -> Path:
        return self.lazy_pack_root / "ffmpeg"

    @property
    def source_dir(self) -> Path:
        return self.lazy_pack_root / "Index-TTS"

    @property
    def model_dir(self) -> Path:
        return self.source_dir / "checkpoints"

    @property
    def worker_script(self) -> Path:
        return self.settings.workspace_root / "apps" / "api" / "tools" / "indextts2_worker.py"

    def build_environment(self) -> dict[str, str]:
        environment = os.environ.copy()
        environment["HF_HOME"] = str(self.lazy_pack_root / "models")
        environment["XDG_CACHE_HOME"] = str(self.lazy_pack_root / "models")
        environment["HF_ENDPOINT"] = "https://hf-mirror.com"
        environment["HF_HUB_OFFLINE"] = "1"
        environment["TRANSFORMERS_OFFLINE"] = "1"
        environment["PYTHONIOENCODING"] = "utf-8"
        prepend_paths = [
            str(self.python_dir),
            str(self.python_dir / "Scripts"),
            str(self.ffmpeg_dir),
        ]
        environment["PATH"] = os.pathsep.join(prepend_paths + [environment.get("PATH", "")])
        return environment

    def build_command(self) -> list[str]:
        return [
            self.python_executable,
            str(self.worker_script),
            "--source-dir",
            str(self.source_dir),
            "--model-dir",
            str(self.model_dir),
            "--config",
            str(self.model_dir / "config.yaml"),
            "--max-text-tokens-per-segment",
            "120",
            "--fp16",
        ]

    def start(self) -> None:
        if self.process is not None and self.process.poll() is None:
            return

        self._stdout_queue = queue.Queue()
        self.process = self.popen(
            self.build_command(),
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            encoding="utf-8",
            errors="replace",
            cwd=str(self.source_dir),
            env=self.build_environment(),
            bufsize=1,
        )
        self._start_reader_thread(self.process.stdout)
        message = self._read_message(timeout_seconds=self.ready_timeout_seconds)
        if message.get("type") != "ready":
            raise RuntimeError(f"IndexTTS2 worker failed to become ready: {message}")
        self.last_started_at = self.now_factory()
        self.last_used_at = self.last_started_at
        self._schedule_idle_release()

    def synthesize(self, request: SpeechRequest, output_path: Path, prompt_audio: str) -> Path:
        with self._lock:
            self.start()
            message = {
                "type": "synthesize",
                "text": request.input,
                "prompt_audio": prompt_audio,
                "output": str(output_path),
                "emotion_text": request.emotion,
                "max_text_tokens_per_segment": 120,
            }
            assert self.process is not None
            assert self.process.stdin is not None
            self.process.stdin.write(json.dumps(message, ensure_ascii=False) + "\n")
            self.process.stdin.flush()

            while True:
                response = self._read_message(timeout_seconds=self.request_timeout_seconds)
                if response.get("type") == "result":
                    self.mark_used()
                    return Path(response["output_path"])
                if response.get("type") == "error":
                    raise RuntimeError(response.get("message", "IndexTTS2 worker failed"))

    def mark_used(self) -> None:
        self.last_used_at = self.now_factory()
        self._schedule_idle_release()

    def shutdown(self) -> bool:
        if self._idle_timer is not None:
            self._idle_timer.cancel()
            self._idle_timer = None
        if self.process is None or self.process.poll() is not None:
            return False
        if self._lock.locked():
            return False
        try:
            assert self.process.stdin is not None
            self.process.stdin.write(json.dumps({"type": "shutdown"}) + "\n")
            self.process.stdin.flush()
        except Exception:
            self.process.terminate()
        finally:
            self.process = None
            self.last_used_at = None
        return True

    def status(self) -> dict:
        loaded = self.process is not None and self.process.poll() is None
        idle_timeout = self.settings.indextts2_idle_timeout_seconds
        idle_seconds = int(self.now_factory() - self.last_used_at) if self.last_used_at else None
        return {
            "model": "indextts2",
            "loaded": loaded,
            "state": "loaded" if loaded else "released",
            "idle_timeout_seconds": idle_timeout,
            "idle_seconds": idle_seconds,
            "release_in_seconds": max(0, idle_timeout - idle_seconds) if loaded and idle_seconds is not None else None,
            "last_started_at": self.last_started_at,
            "last_used_at": self.last_used_at,
            "managed": loaded,
            "can_stop": loaded and not self._lock.locked(),
            "active_requests": 1 if self._lock.locked() else 0,
        }

    def _schedule_idle_release(self) -> None:
        timeout_seconds = self.settings.indextts2_idle_timeout_seconds
        if timeout_seconds <= 0:
            return
        if self._idle_timer is not None:
            self._idle_timer.cancel()
        self._idle_timer = self.timer_factory(timeout_seconds, self._release_if_idle)
        self._idle_timer.daemon = True
        self._idle_timer.start()

    def _release_if_idle(self) -> None:
        if self._lock.locked():
            self._schedule_idle_release()
            return
        if self.last_used_at is None:
            return
        if self.now_factory() - self.last_used_at < self.settings.indextts2_idle_timeout_seconds:
            self._schedule_idle_release()
            return
        self.shutdown()

    def _start_reader_thread(self, stdout: TextIO | None) -> None:
        if stdout is None:
            raise RuntimeError("IndexTTS2 worker stdout pipe was not created.")

        def read_stdout() -> None:
            for line in stdout:
                self._stdout_queue.put(line)

        self._reader_thread = threading.Thread(target=read_stdout, daemon=True)
        self._reader_thread.start()

    def _read_message(self, timeout_seconds: float) -> dict:
        deadline = time.monotonic() + timeout_seconds
        while time.monotonic() < deadline:
            remaining = max(0.01, deadline - time.monotonic())
            try:
                line = self._stdout_queue.get(timeout=remaining)
            except queue.Empty:
                break
            try:
                message = json.loads(line)
            except json.JSONDecodeError:
                continue
            if isinstance(message, dict):
                return message
        raise TimeoutError("Timed out waiting for IndexTTS2 worker response.")


_worker_clients: dict[tuple[str, str], IndexTts2WorkerClient] = {}


def get_indextts2_worker_client(settings: Settings) -> IndexTts2WorkerClient:
    key = (str(settings.workspace_root), str(settings.indextts2_root))
    if key not in _worker_clients:
        _worker_clients[key] = IndexTts2WorkerClient(settings=settings)
    else:
        _worker_clients[key].settings = settings
        _worker_clients[key].lazy_pack_root = settings.indextts2_root
    return _worker_clients[key]


def get_indextts2_worker_status(settings: Settings) -> dict:
    key = (str(settings.workspace_root), str(settings.indextts2_root))
    client = _worker_clients.get(key)
    if client is None:
        return {
            "model": "indextts2",
            "loaded": False,
            "state": "released",
            "idle_timeout_seconds": settings.indextts2_idle_timeout_seconds,
            "idle_seconds": None,
            "release_in_seconds": None,
            "last_started_at": None,
            "last_used_at": None,
            "managed": False,
            "can_stop": False,
            "active_requests": 0,
        }
    return client.status()


def shutdown_indextts2_workers() -> None:
    for client in _worker_clients.values():
        client.shutdown()
    _worker_clients.clear()


def release_indextts2_worker(settings: Settings) -> bool:
    key = (str(settings.workspace_root), str(settings.indextts2_root))
    client = _worker_clients.get(key)
    return client.shutdown() if client is not None else False
