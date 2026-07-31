"""Offline one-shot Qwen3-ASR worker for OpenTTS.

It receives only a short-lived local JSON request and writes a short-lived JSON
response. The parent owns lifecycle, timeout and cleanup; this worker never
contacts a network service or prints transcripts to logs.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path


class WorkerFailure(RuntimeError):
    pass


def _write(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def _pick_file(model_dir: Path, preferred: list[str], pattern: str, label: str) -> str:
    for name in preferred:
        if (model_dir / name).is_file():
            return name
    matches = sorted(model_dir.glob(pattern), key=lambda path: path.name)
    if matches:
        return matches[0].name
    raise WorkerFailure(f"本地 {label} 模型文件不完整。")


def _asr_files(model_dir: Path) -> dict[str, str]:
    return {
        "encoder_frontend_fn": _pick_file(
            model_dir,
            ["qwen3_asr_encoder_frontend.onnx", "qwen3_asr_encoder_frontend.int4.onnx"],
            "qwen3_asr_encoder_frontend*.onnx",
            "Qwen3-ASR frontend",
        ),
        "encoder_backend_fn": _pick_file(
            model_dir,
            ["qwen3_asr_encoder_backend.onnx", "qwen3_asr_encoder_backend.int4.onnx"],
            "qwen3_asr_encoder_backend*.onnx",
            "Qwen3-ASR backend",
        ),
        "llm_fn": _pick_file(
            model_dir,
            ["qwen3_asr_llm.gguf", "qwen3_asr_llm.q5_k.gguf", "qwen3_asr_llm.q4_k.gguf"],
            "qwen3_asr_llm*.gguf",
            "Qwen3-ASR LLM",
        ),
    }


def _load_audio(audio_path: Path, ffmpeg_path: str):
    import numpy as np

    completed = subprocess.run(
        [
            ffmpeg_path,
            "-nostdin",
            "-v",
            "error",
            "-i",
            str(audio_path),
            "-f",
            "f32le",
            "-ac",
            "1",
            "-ar",
            "16000",
            "-",
        ],
        capture_output=True,
        check=False,
    )
    if completed.returncode != 0:
        raise WorkerFailure("无法用本地 ffmpeg 解码音频。")
    samples = np.frombuffer(completed.stdout, dtype=np.float32)
    if len(samples) < 400:
        raise WorkerFailure("音频过短，无法进行可靠识别。")
    return samples


def _transcribe(samples, model_dir: Path, provider: str, use_gpu: bool, language: str) -> str:
    from core.server.engines.qwen_asr_gguf.asr_engine import QwenASREngine
    from core.server.engines.qwen_asr_gguf.inference.schema import ASREngineConfig

    files = _asr_files(model_dir)
    recognizer = QwenASREngine(
        ASREngineConfig(
            model_dir=str(model_dir),
            encoder_frontend_fn=files["encoder_frontend_fn"],
            encoder_backend_fn=files["encoder_backend_fn"],
            llm_fn=files["llm_fn"],
            onnx_provider=provider,
            llm_use_gpu=use_gpu,
            dml_pad_to=60,
            chunk_size=60,
        )
    )
    try:
        stream = recognizer.create_stream()
        stream.accept_waveform(16000, samples)
        recognizer.decode_stream(stream, context="", language=language)
        text = str(stream.result.text or "").strip()
        if not text:
            raise WorkerFailure("Qwen3-ASR 没有识别出可用文本。")
        return text
    finally:
        recognizer.cleanup()


def _run(request: dict) -> dict:
    language = str(request.get("language") or "zh")
    if language.lower() not in {"zh", "zh-cn", "zh_hans"}:
        raise WorkerFailure("当前本地 Qwen3-ASR 配置仅启用中文（zh）。")
    capswriter_root = Path(str(request.get("capswriter_root") or ""))
    model_dir = Path(str(request.get("model_dir") or ""))
    audio_path = Path(str(request.get("audio_path") or ""))
    if not capswriter_root.is_dir() or not model_dir.is_dir() or not audio_path.is_file():
        raise WorkerFailure("本地 Qwen3-ASR 运行时、模型或音频不存在。")
    sys.path.insert(0, str(capswriter_root.resolve()))
    # Legacy requests sent one ``device`` field. New requests are resolved by
    # the parent so a CUDA request cannot silently use DirectML or CPU.
    active_device = str(request.get("active_device") or request.get("device") or "cpu").lower()
    provider = str(request.get("onnx_provider") or ("DML" if active_device == "dml" else "CUDA" if active_device == "cuda" else "CPU"))
    use_gpu = bool(request.get("llm_use_gpu", active_device in {"cuda", "dml"}))
    samples = _load_audio(audio_path, str(request.get("ffmpeg_path") or "ffmpeg"))
    try:
        from qwen_capswriter_backend import CapsWriterBackendError, configure_capswriter_backends

        configure_capswriter_backends(active_device=active_device, cuda_backend_dir=request.get("cuda_backend_dir"))
    except CapsWriterBackendError as exc:
        raise WorkerFailure(str(exc)) from exc
    return {"text": _transcribe(samples, model_dir, provider, use_gpu, language), "language": "zh", "model": "qwen3-asr-1.7b"}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--request", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    output = Path(args.output)
    try:
        request = json.loads(Path(args.request).read_text(encoding="utf-8"))
        if not isinstance(request, dict):
            raise WorkerFailure("本地 ASR 请求格式无效。")
        _write(output, {"ok": True, "result": _run(request)})
        return 0
    except WorkerFailure as exc:
        _write(output, {"ok": False, "error": {"code": "ASR_FAILED", "message": str(exc)}})
        return 1
    except Exception:
        _write(output, {"ok": False, "error": {"code": "ASR_INTERNAL_ERROR", "message": "本地 Qwen3-ASR 出现未预期错误；请检查模型安装与运行时。"}})
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
