"""Install OpenTTS's self-contained NVIDIA CUDA runtime for Qwen ASR.

This installer deliberately creates a second Qwen Python runtime instead of
replacing ``Qwen3-runtime``. The existing DirectML runtime remains available
for portable fallback. All downloads are official local runtime dependencies;
no audio, transcript, voice reference, or credential leaves the machine.
"""

from __future__ import annotations

import argparse
import hashlib
import os
import shutil
import subprocess
import sys
import tempfile
import urllib.request
import zipfile
from pathlib import Path


LLAMA_RELEASE = "b7798"
CUDA_VERSION = "12.4"
ORT_VERSION = "1.24.4"
CUDNN_VERSION = "9.11.1.4"
CUDA_RUNTIME_VERSION = "12.4.127"
# ONNX Runtime deliberately does not declare CUDA shared libraries as Python
# requirements.  Install the complete CUDA 12 family it links against so an
# isolated OpenTTS runtime does not accidentally borrow DLLs from another app.
CUDA_PYTHON_PACKAGES = (
    "nvidia-cublas-cu12",
    "nvidia-cuda-nvrtc-cu12",
    f"nvidia-cuda-runtime-cu12=={CUDA_RUNTIME_VERSION}",
    f"nvidia-cudnn-cu12=={CUDNN_VERSION}",
    "nvidia-cufft-cu12",
    "nvidia-curand-cu12",
    "nvidia-cusolver-cu12",
    "nvidia-cusparse-cu12",
    "nvidia-nvjitlink-cu12",
)
ASSETS = {
    "llama": {
        "url": "https://github.com/ggml-org/llama.cpp/releases/download/b7798/llama-b7798-bin-win-cuda-12.4-x64.zip",
        "sha256": "54eabd5496239e89ebe48ed52ae3b6ee5b41ae9d313c3391c56bfa3c279620f0",
    },
    "cudart": {
        "url": "https://github.com/ggml-org/llama.cpp/releases/download/b7798/cudart-llama-bin-win-cuda-12.4-x64.zip",
        "sha256": "8c79a9b226de4b3cacfd1f83d24f962d0773be79f1e7b75c6af4ded7e32ae1d6",
    },
}
SHARED_CUDA_DLLS = {"cublas64_12.dll", "cublaslt64_12.dll", "cudart64_12.dll"}
NATIVE_BACKENDS = ("asr", "aligner")


class InstallError(RuntimeError):
    pass


def parse_args() -> argparse.Namespace:
    workspace = Path(__file__).resolve().parents[3]
    models = workspace / "models"
    parser = argparse.ArgumentParser(description="Install the isolated OpenTTS Qwen CUDA runtime.")
    parser.add_argument("--source-runtime", type=Path, default=models / "Qwen3-runtime")
    parser.add_argument("--target-runtime", type=Path, default=models / "Qwen3-runtime-cuda")
    parser.add_argument("--cuda-backend-dir", type=Path, default=models / "CapsWriter-Offline" / ".open-tts-backends" / "cuda")
    parser.add_argument("--asr-model-dir", type=Path, default=models / "Qwen3-ASR-1.7B")
    parser.add_argument("--download-cache", type=Path, default=models / ".open-tts-downloads")
    parser.add_argument("--force", action="store_true", help="Replace an existing target runtime after a successful rebuild.")
    return parser.parse_args()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def download(url: str, destination: Path, expected_sha256: str) -> None:
    if destination.is_file() and sha256_file(destination).lower() == expected_sha256.lower():
        return
    destination.parent.mkdir(parents=True, exist_ok=True)
    request = urllib.request.Request(url, headers={"User-Agent": "OpenTTS-Local-CUDA-Installer"})
    with urllib.request.urlopen(request, timeout=60) as response, destination.open("wb") as handle:
        shutil.copyfileobj(response, handle)
    actual = sha256_file(destination)
    if actual.lower() != expected_sha256.lower():
        destination.unlink(missing_ok=True)
        raise InstallError(f"CUDA 运行时下载校验失败：{destination.name}")


def copy_archive_files(archive: Path, destination: Path) -> None:
    with tempfile.TemporaryDirectory(prefix="open-tts-llama-cuda-") as temporary:
        unpacked = Path(temporary)
        with zipfile.ZipFile(archive) as zip_file:
            zip_file.extractall(unpacked)
        for source in unpacked.rglob("*"):
            if not source.is_file():
                continue
            target = destination / source.name
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, target)


def copy_native_backend(source_dir: Path, destination: Path) -> None:
    """Copy llama native state per engine; CUDA Runtime stays shared by pip."""

    destination.mkdir(parents=True, exist_ok=True)
    for source in source_dir.glob("*.dll"):
        if source.name.lower() in SHARED_CUDA_DLLS:
            continue
        shutil.copy2(source, destination / source.name)


def cuda_library_dirs(runtime: Path, backend_dir: Path) -> list[Path]:
    site_packages = runtime / "Lib" / "site-packages"
    dirs = [backend_dir / name / "bin" for name in NATIVE_BACKENDS]
    nvidia = site_packages / "nvidia"
    if nvidia.is_dir():
        dirs.extend(path for path in nvidia.glob("*/bin") if path.is_dir())
    return dirs


def cuda_environment(runtime: Path, backend_dir: Path) -> dict[str, str]:
    environment = os.environ.copy()
    dll_dirs = [str(path) for path in cuda_library_dirs(runtime, backend_dir)]
    environment["PATH"] = os.pathsep.join(dll_dirs + [environment.get("PATH", "")])
    environment["PYTHONUTF8"] = "1"
    return environment


def run(command: list[str], *, env: dict[str, str] | None = None) -> None:
    completed = subprocess.run(command, env=env, check=False)
    if completed.returncode != 0:
        raise InstallError(f"本地 CUDA 运行时命令失败：{Path(command[0]).name}")


def install_python_runtime(source: Path, staging: Path, backend_dir: Path, asr_model_dir: Path) -> None:
    if not (source / "python.exe").is_file():
        raise InstallError("找不到现有 Qwen3-runtime，无法创建独立 CUDA 运行时。")
    shutil.copytree(source, staging)
    python = staging / "python.exe"
    run([str(python), "-m", "pip", "uninstall", "-y", "onnxruntime-directml", "onnxruntime"])
    run(
        [
            str(python),
            "-m",
            "pip",
            "install",
            "--disable-pip-version-check",
            f"onnxruntime-gpu=={ORT_VERSION}",
            *CUDA_PYTHON_PACKAGES,
        ]
    )
    frontend = asr_model_dir / "qwen3_asr_encoder_frontend.onnx"
    if not frontend.is_file():
        raise InstallError("Qwen3-ASR ONNX 模型不存在，无法验证 CUDAExecutionProvider。")
    check = (
        "import onnxruntime as ort; "
        "assert 'CUDAExecutionProvider' in ort.get_available_providers(), ort.get_available_providers(); "
        f"s=ort.InferenceSession(r'{frontend}', providers=['CUDAExecutionProvider','CPUExecutionProvider']); "
        "assert s.get_providers()[0]=='CUDAExecutionProvider', s.get_providers(); "
        "print('CUDAExecutionProvider ready')"
    )
    run([str(python), "-c", check], env=cuda_environment(staging, backend_dir))


def install_cuda_backend(backend_dir: Path, download_cache: Path) -> None:
    backend_dir.mkdir(parents=True, exist_ok=True)
    payload_dir = backend_dir / ".payload"
    payload_dir.mkdir(parents=True, exist_ok=True)
    for name, asset in ASSETS.items():
        archive = download_cache / f"llama-{LLAMA_RELEASE}-{name}.zip"
        download(asset["url"], archive, asset["sha256"])
        copy_archive_files(archive, payload_dir)
    for name in NATIVE_BACKENDS:
        copy_native_backend(payload_dir, backend_dir / name / "bin")
    shutil.rmtree(payload_dir)
    required = tuple(
        backend_dir / name / "bin" / filename
        for name in NATIVE_BACKENDS
        for filename in ("llama.dll", "ggml.dll", "ggml-base.dll", "ggml-cuda.dll")
    )
    if not all(path.is_file() for path in required):
        raise InstallError("下载的 llama.cpp CUDA 后端不完整。")


def main() -> int:
    args = parse_args()
    source = args.source_runtime.resolve()
    target = args.target_runtime.resolve()
    backend = args.cuda_backend_dir.resolve()
    model = args.asr_model_dir.resolve()
    download_cache = args.download_cache.resolve()
    if target.exists() and not args.force:
        raise InstallError("Qwen CUDA 运行时已存在；如需重装请显式添加 --force。")

    staging = target.with_name(f"{target.name}.installing")
    if staging.exists():
        shutil.rmtree(staging)
    backend_stage = backend.with_name(f"{backend.name}.installing")
    if backend_stage.exists():
        shutil.rmtree(backend_stage)
    try:
        install_cuda_backend(backend_stage, download_cache)
        install_python_runtime(source, staging, backend_stage, model)
        if target.exists():
            shutil.rmtree(target)
        if backend.exists():
            shutil.rmtree(backend)
        staging.replace(target)
        backend_stage.replace(backend)
    except Exception:
        shutil.rmtree(staging, ignore_errors=True)
        shutil.rmtree(backend_stage, ignore_errors=True)
        raise
    print(f"OpenTTS Qwen CUDA runtime installed: {target}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except InstallError as exc:
        print(f"Install failed: {exc}", file=sys.stderr)
        raise SystemExit(1)
