"""Runtime selection for the local Qwen ASR and forced-alignment stack.

The Qwen models combine an ONNX audio encoder and a llama.cpp GGUF decoder.
Those pieces must use a coherent backend: CUDA uses a dedicated Python runtime
with ``CUDAExecutionProvider`` and a CUDA llama.cpp binary overlay; DirectML
continues to use the existing portable runtime and Vulkan overlay; CPU has to
explicitly disable llama.cpp layer offload.
"""

from __future__ import annotations

from dataclasses import dataclass
import os
from pathlib import Path
from typing import Literal

from tts_api.config import Settings


QwenDevice = Literal["auto", "cuda", "dml", "cpu"]


class QwenRuntimeError(RuntimeError):
    """A safe, user-facing local Qwen runtime configuration error."""


@dataclass(frozen=True)
class ResolvedQwenRuntime:
    requested_device: QwenDevice
    active_device: Literal["cuda", "dml", "cpu"]
    python_executable: Path
    onnx_provider: Literal["CUDA", "DML", "CPU"]
    llm_use_gpu: bool
    llama_backend_dir: Path | None

    @property
    def label(self) -> str:
        if self.active_device == "cuda":
            return "NVIDIA CUDA"
        if self.active_device == "dml":
            return "DirectML + Vulkan"
        return "CPU"


def cuda_backend_dir(settings: Settings) -> Path:
    return settings.qwen_cuda_backend_dir


def cuda_runtime_ready(settings: Settings) -> bool:
    """Check files only; importing CUDA DLLs belongs to the isolated worker."""

    runtime = settings.qwen_cuda_python
    backend_root = cuda_backend_dir(settings)
    backend_dirs = [backend_root / name / "bin" for name in ("asr", "aligner")]
    runtime_root = runtime.parent
    site_packages = runtime_root / "Lib" / "site-packages"
    required = (
        runtime,
        *(path / filename for path in backend_dirs for filename in ("llama.dll", "ggml.dll", "ggml-base.dll", "ggml-cuda.dll")),
        site_packages / "onnxruntime" / "capi" / "onnxruntime_providers_cuda.dll",
        site_packages / "nvidia" / "cufft" / "bin" / "cufft64_11.dll",
        site_packages / "nvidia" / "cudnn" / "bin" / "cudnn64_9.dll",
    )
    return all(path.is_file() for path in required)


def qwen_worker_environment(runtime: ResolvedQwenRuntime, base: dict[str, str] | None = None) -> dict[str, str]:
    """Return a child-only environment with isolated CUDA DLL lookup paths."""

    environment = (base or os.environ).copy()
    if runtime.active_device != "cuda":
        return environment
    runtime_root = runtime.python_executable.parent
    nvidia_root = runtime_root / "Lib" / "site-packages" / "nvidia"
    directories = [runtime.llama_backend_dir / name / "bin" for name in ("asr", "aligner")] if runtime.llama_backend_dir else []
    if nvidia_root.is_dir():
        directories.extend(path for path in nvidia_root.glob("*/bin") if path.is_dir())
    if directories:
        environment["PATH"] = os.pathsep.join([*(str(path) for path in directories), environment.get("PATH", "")])
    return environment


def dml_runtime_ready(settings: Settings, fallback_python: Path | None = None) -> bool:
    return (fallback_python or settings.qwen_asr_python).is_file()


def resolve_qwen_runtime(
    settings: Settings, requested: QwenDevice | str, *, fallback_python: Path | None = None
) -> ResolvedQwenRuntime:
    """Resolve a deterministic backend without silently changing GPU class.

    ``auto`` is intentionally a capability fallback only: CUDA is preferred on
    a prepared NVIDIA installation, then the existing DirectML/Vulkan runtime,
    then CPU. Explicit selections fail with an actionable local setup message
    rather than pretending that a different backend was used.
    """

    value = str(requested or "auto").lower().strip()
    if value not in {"auto", "cuda", "dml", "cpu"}:
        raise QwenRuntimeError("本地 Qwen 设备必须是 auto、cuda、dml 或 cpu。")
    device: QwenDevice = value  # type: ignore[assignment]

    if device == "cuda" or (device == "auto" and cuda_runtime_ready(settings)):
        if not cuda_runtime_ready(settings):
            raise QwenRuntimeError("Qwen CUDA 运行时未安装；请先安装本地 NVIDIA CUDA 加速组件。")
        return ResolvedQwenRuntime(
            requested_device=device,
            active_device="cuda",
            python_executable=settings.qwen_cuda_python,
            onnx_provider="CUDA",
            llm_use_gpu=True,
            llama_backend_dir=cuda_backend_dir(settings),
        )

    standard_python = fallback_python or settings.qwen_asr_python
    if device == "dml" or (device == "auto" and dml_runtime_ready(settings, standard_python)):
        if not dml_runtime_ready(settings, standard_python):
            raise QwenRuntimeError("Qwen DirectML 运行时不存在；请检查本地 Qwen3-runtime 安装。")
        return ResolvedQwenRuntime(
            requested_device=device,
            active_device="dml",
            python_executable=standard_python,
            onnx_provider="DML",
            llm_use_gpu=True,
            llama_backend_dir=None,
        )

    if not standard_python.is_file():
        raise QwenRuntimeError("Qwen CPU 运行时不存在；请检查本地 Qwen3-runtime 安装。")
    return ResolvedQwenRuntime(
        requested_device=device,
        active_device="cpu",
        python_executable=standard_python,
        onnx_provider="CPU",
        llm_use_gpu=False,
        llama_backend_dir=None,
    )


def runtime_status(settings: Settings) -> dict[str, object]:
    """Safe settings/status payload; it contains no media, voice or secret data."""

    cuda_dir = cuda_backend_dir(settings)
    return {
        "cuda_available": cuda_runtime_ready(settings),
        "cuda_python_installed": settings.qwen_cuda_python.is_file(),
        "cuda_llama_backend_installed": all(
            (cuda_dir / name / "bin" / "ggml-cuda.dll").is_file() for name in ("asr", "aligner")
        ),
        "dml_runtime_available": dml_runtime_ready(settings),
    }
