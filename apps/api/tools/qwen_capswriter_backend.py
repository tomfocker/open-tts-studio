"""Select a CapsWriter llama.cpp backend inside an isolated Qwen worker.

CapsWriter locates native llama.cpp libraries relative to each engine's
``inference/llama.py``.  We keep vendor files untouched and redirect that
single lookup to an OpenTTS-managed CUDA overlay when requested.  This keeps
the original Vulkan tree available for DirectML fallback.
"""

from __future__ import annotations

import importlib.abc
import importlib.machinery
import os
import sys
from pathlib import Path


class CapsWriterBackendError(RuntimeError):
    pass


# ``os.add_dll_directory`` returns a handle whose lifetime controls the search
# entry.  Keep every handle alive for the worker process; otherwise Python may
# unload the directory before ONNX Runtime or llama.cpp loads a lazy CUDA DLL.
_DLL_DIRECTORY_HANDLES: list[object] = []


def _backend_root(value: str | Path | None) -> Path | None:
    if not value:
        return None
    return Path(value)


def _backend_for(root: Path, kind: str) -> Path:
    """Select a separate native state domain for ASR and forced alignment."""

    candidate = root / kind
    return candidate if (candidate / "bin").is_dir() else root


def _cuda_library_dirs(backend_dir: Path) -> list[Path]:
    asr_dir = _backend_for(backend_dir, "asr") / "bin"
    aligner_dir = _backend_for(backend_dir, "aligner") / "bin"
    # The upstream Python wrappers both call llama_backend_init() at import
    # time.  Loading them from the same DLL path aliases native globals and
    # corrupts a mixed ASR+aligner process. They need separate DLL images.
    library_dirs = [asr_dir, aligner_dir]
    required = (
        *(path / filename for path in library_dirs for filename in ("llama.dll", "ggml.dll", "ggml-base.dll", "ggml-cuda.dll")),
    )
    if not all(path.is_file() for path in required):
        raise CapsWriterBackendError("本地 Qwen CUDA llama.cpp 后端不完整；请重新安装 CUDA 加速组件。")
    nvidia_root = Path(sys.prefix) / "Lib" / "site-packages" / "nvidia"
    directories = library_dirs
    if nvidia_root.is_dir():
        directories.extend(path for path in nvidia_root.glob("*/bin") if path.is_dir())
    return directories


def _register_cuda_dll_directories(backend_dir: Path) -> None:
    """Make CUDA/ONNX/llama DLLs discoverable for the complete worker life."""

    directories = _cuda_library_dirs(backend_dir)
    existing = os.environ.get("PATH", "")
    os.environ["PATH"] = os.pathsep.join([*(str(path) for path in directories), existing])
    if hasattr(os, "add_dll_directory"):
        _DLL_DIRECTORY_HANDLES.extend(os.add_dll_directory(str(path)) for path in directories)


class _CudaLlamaLoader(importlib.abc.Loader):
    """Run an unchanged vendor llama wrapper with an overlay ``__file__``."""

    def __init__(self, source: Path, backend_dir: Path):
        self.source = source
        self.backend_dir = backend_dir

    def create_module(self, spec):  # pragma: no cover - default import machinery path
        return None

    def exec_module(self, module) -> None:
        # CapsWriter calls ``init()`` during this module's top-level execution.
        # Set __file__ first so that init() searches the CUDA overlay's bin/.
        module.__file__ = str(self.backend_dir / "open_tts_backend.py")
        code = compile(self.source.read_bytes(), module.__file__, "exec")
        exec(code, module.__dict__)


class _CudaLlamaFinder(importlib.abc.MetaPathFinder):
    def __init__(self, backend_root: Path):
        self.backends = {
            "core.server.engines.qwen_asr_gguf.inference.llama": _backend_for(backend_root, "asr"),
            "core.server.engines.force_aligner_gguf.inference.llama": _backend_for(backend_root, "aligner"),
        }

    def find_spec(self, fullname: str, path=None, target=None):
        backend_dir = self.backends.get(fullname)
        if backend_dir is None:
            return None
        source_spec = importlib.machinery.PathFinder.find_spec(fullname, path)
        source_name = source_spec.origin if source_spec is not None else None
        if not source_name:
            raise CapsWriterBackendError("无法定位本地 CapsWriter llama 包装器。")
        return importlib.machinery.ModuleSpec(
            fullname,
            _CudaLlamaLoader(Path(source_name), backend_dir),
            origin=source_name,
        )


def _install_cuda_import_hook(backend_dir: Path) -> None:
    """Redirect llama before a parent package imports it, never afterwards."""

    targets = _CudaLlamaFinder(backend_dir).backends
    if any(name in sys.modules for name in targets):
        raise CapsWriterBackendError("Qwen CUDA 后端必须在 CapsWriter 引擎导入前初始化。")
    if any(isinstance(finder, _CudaLlamaFinder) for finder in sys.meta_path):
        return
    sys.meta_path.insert(0, _CudaLlamaFinder(backend_dir))


def _strict_cpu_patch(module) -> None:
    """Prevent CapsWriter's ``n_gpu_layers=-1`` default leaking to Vulkan.

    The vendor wrapper used ``devices=None`` for CPU but retained ``-1`` GPU
    layers, which still offloaded all layers when a GPU backend was present.
    Patching the constructor at worker startup keeps vendor files immutable and
    makes the public CPU mode truthful.
    """

    cls = module.LlamaModel
    if getattr(cls, "_open_tts_strict_cpu_patch", False):
        return
    original_init = cls.__init__

    def strict_init(self, path, n_gpu_layers=-1, use_gpu=1):
        if not use_gpu:
            return original_init(self, path, n_gpu_layers=0, use_gpu=False)
        return original_init(self, path, n_gpu_layers=n_gpu_layers, use_gpu=use_gpu)

    cls.__init__ = strict_init
    cls._open_tts_strict_cpu_patch = True


def configure_capswriter_backends(*, active_device: str, cuda_backend_dir: str | Path | None) -> None:
    """Configure both Qwen ASR and ForcedAligner llama wrappers.

    ``active_device`` is already resolved by the FastAPI parent.  Unknown
    values are rejected to ensure a worker cannot silently fall back from an
    explicitly requested CUDA job to another device class.
    """

    if active_device not in {"cuda", "dml", "cpu"}:
        raise CapsWriterBackendError("本地 Qwen 后端设备无效。")

    if active_device == "cuda":
        backend_dir = _backend_root(cuda_backend_dir)
        if backend_dir is None:
            raise CapsWriterBackendError("本地 Qwen CUDA llama.cpp 后端未配置。")
        _register_cuda_dll_directories(backend_dir)
        _install_cuda_import_hook(backend_dir)
    elif active_device == "cpu":
        from core.server.engines.force_aligner_gguf.inference import llama as aligner_llama
        from core.server.engines.qwen_asr_gguf.inference import llama as asr_llama

        modules = (asr_llama, aligner_llama)
        for module in modules:
            _strict_cpu_patch(module)
