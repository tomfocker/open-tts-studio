from pathlib import Path

import pytest

from tts_api.config import Settings
from tts_api.qwen_runtime import QwenRuntimeError, qwen_worker_environment, resolve_qwen_runtime, runtime_status


def _touch(path: Path) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b"local-test-runtime")
    return path


def _cuda_settings(tmp_path: Path) -> Settings:
    runtime = _touch(tmp_path / "Qwen3-runtime-cuda" / "python.exe")
    dml_python = _touch(tmp_path / "Qwen3-runtime" / "python.exe")
    backend = tmp_path / "cuda-backend"
    for kind in ("asr", "aligner"):
        for name in ("llama.dll", "ggml.dll", "ggml-base.dll", "ggml-cuda.dll"):
            _touch(backend / kind / "bin" / name)
    _touch(runtime.parent / "Lib" / "site-packages" / "onnxruntime" / "capi" / "onnxruntime_providers_cuda.dll")
    _touch(runtime.parent / "Lib" / "site-packages" / "nvidia" / "cufft" / "bin" / "cufft64_11.dll")
    _touch(runtime.parent / "Lib" / "site-packages" / "nvidia" / "cudnn" / "bin" / "cudnn64_9.dll")
    return Settings(qwen_cuda_python=runtime, qwen_cuda_backend_dir=backend, qwen_asr_python=dml_python)


def test_auto_prefers_complete_cuda_runtime_and_prepares_child_dll_paths(tmp_path: Path):
    settings = _cuda_settings(tmp_path)

    runtime = resolve_qwen_runtime(settings, "auto")
    environment = qwen_worker_environment(runtime, {"PATH": "base"})

    assert runtime.active_device == "cuda"
    assert runtime.onnx_provider == "CUDA"
    assert runtime.llm_use_gpu is True
    assert str(settings.qwen_cuda_backend_dir / "asr" / "bin") in environment["PATH"]
    assert str(settings.qwen_cuda_backend_dir / "aligner" / "bin") in environment["PATH"]
    assert runtime_status(settings)["cuda_available"] is True


def test_explicit_cuda_fails_without_a_complete_local_runtime(tmp_path: Path):
    settings = Settings(qwen_cuda_python=tmp_path / "missing.exe", qwen_asr_python=_touch(tmp_path / "dml" / "python.exe"))

    with pytest.raises(QwenRuntimeError, match="CUDA 运行时未安装"):
        resolve_qwen_runtime(settings, "cuda")

    assert resolve_qwen_runtime(settings, "auto").active_device == "dml"


def test_cpu_mode_never_requests_llama_gpu_offload(tmp_path: Path):
    settings = Settings(qwen_asr_python=_touch(tmp_path / "Qwen3-runtime" / "python.exe"))

    runtime = resolve_qwen_runtime(settings, "cpu")

    assert runtime.active_device == "cpu"
    assert runtime.onnx_provider == "CPU"
    assert runtime.llm_use_gpu is False
