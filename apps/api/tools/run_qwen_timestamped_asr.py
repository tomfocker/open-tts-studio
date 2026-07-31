"""Offline Qwen3-ASR plus Qwen3-ForcedAligner worker for local subtitles.

This is an in-tree Python adaptation of the maintained CapsWriter flow in
``pr-uxp-message-demo/server/capswriter_json_runner.py``.  The FastAPI parent
owns task state and requests; this isolated worker only reads one managed
audio/video file and writes one short-lived JSON response.  It never logs a
media path, transcript, or model request to stdout/stderr.
"""

from __future__ import annotations

import argparse
import json
import math
import subprocess
import sys
import wave
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
    matches = sorted(model_dir.glob(pattern), key=lambda item: item.name)
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


def _aligner_files(model_dir: Path) -> dict[str, str]:
    return {
        "encoder_frontend_fn": _pick_file(
            model_dir,
            ["qwen3_aligner_encoder_frontend.int4.onnx", "qwen3_aligner_encoder_frontend.onnx"],
            "qwen3_aligner_encoder_frontend*.onnx",
            "Qwen3-ForcedAligner frontend",
        ),
        "encoder_backend_fn": _pick_file(
            model_dir,
            ["qwen3_aligner_encoder_backend.int4.onnx", "qwen3_aligner_encoder_backend.onnx"],
            "qwen3_aligner_encoder_backend*.onnx",
            "Qwen3-ForcedAligner backend",
        ),
        "llm_fn": _pick_file(
            model_dir,
            ["qwen3_aligner_llm.q5_k.gguf", "qwen3_aligner_llm.q4_k.gguf", "qwen3_aligner_llm.gguf"],
            "qwen3_aligner_llm*.gguf",
            "Qwen3-ForcedAligner LLM",
        ),
    }


def _load_with_ffmpeg(path: Path, ffmpeg_path: str):
    import numpy as np

    completed = subprocess.run(
        [ffmpeg_path, "-nostdin", "-v", "error", "-i", str(path), "-f", "f32le", "-ac", "1", "-ar", "16000", "-"],
        capture_output=True,
        check=False,
    )
    if completed.returncode != 0:
        raise WorkerFailure("无法用本地 ffmpeg 解码媒体音轨。")
    samples = np.frombuffer(completed.stdout, dtype=np.float32)
    if len(samples) < 400:
        raise WorkerFailure("媒体音轨过短，无法进行可靠识别。")
    return samples


def _load_pcm_wav(path: Path):
    import numpy as np

    with wave.open(str(path), "rb") as wav:
        sample_rate = wav.getframerate()
        channels = wav.getnchannels()
        width = wav.getsampwidth()
        frames = wav.readframes(wav.getnframes())
    if sample_rate != 16000:
        raise WorkerFailure("媒体解码失败；请安装本地 ffmpeg。")
    if width == 2:
        samples = np.frombuffer(frames, dtype=np.int16).astype(np.float32) / 32768.0
    elif width == 4:
        samples = np.frombuffer(frames, dtype=np.int32).astype(np.float32) / 2147483648.0
    else:
        raise WorkerFailure("WAV 位深不受支持，请使用本地 ffmpeg 解码。")
    return samples.reshape(-1, channels).mean(axis=1) if channels > 1 else samples


def _load_audio(path: Path, ffmpeg_path: str):
    try:
        return _load_with_ffmpeg(path, ffmpeg_path)
    except WorkerFailure:
        if path.suffix.lower() != ".wav":
            raise
        return _load_pcm_wav(path)


def _chunk_settings(request: dict) -> tuple[float, float]:
    size = max(1.0, float(request.get("chunk_size") or 60.0))
    overlap = max(0.0, float(request.get("chunk_overlap") or 5.0))
    return size, min(overlap, max(0.0, size - 0.5))


def _iter_chunks(samples, size_seconds: float, overlap_seconds: float):
    sample_rate = 16000
    chunk_samples = max(1, int(size_seconds * sample_rate))
    overlap_samples = min(max(0, int(overlap_seconds * sample_rate)), max(0, chunk_samples - sample_rate // 2))
    stride = max(1, chunk_samples - overlap_samples)
    start = 0
    while start < len(samples):
        end = min(len(samples), start + chunk_samples)
        yield start / sample_rate, samples[start:end]
        if end >= len(samples):
            break
        start += stride


def _decode_chunk(recognizer, aligner, samples, language: str, context: str):
    stream = recognizer.create_stream()
    stream.accept_waveform(16000, samples)
    recognizer.decode_stream(stream, context=context, language=language)
    text = str(getattr(stream.result, "text", "") or "").strip()
    tokens = list(getattr(stream.result, "tokens", []) or [])
    timestamps = [float(value) for value in (getattr(stream.result, "timestamps", []) or [])]
    if text:
        aligned = aligner.align(audio=samples, text=text, language=language, offset_sec=0.0)
        if aligned and getattr(aligned, "items", None):
            tokens = [str(getattr(item, "text", "") or "") for item in aligned.items]
            timestamps = [float(getattr(item, "start_time", 0.0)) for item in aligned.items]
    return text, tokens, timestamps


def _valid_timestamp_pairs(tokens, timestamps, chunk_duration: float):
    """Keep only actual per-chunk bounds; never clamp a model timestamp.

    The GGUF aligner occasionally reports positions in the fixed-length
    encoder padding after a short final chunk.  Those positions belong to no
    audio frame in the imported media.  Dropping them is truthful; moving them
    to the final frame would fabricate a subtitle boundary.
    """

    pairs = []
    dropped = 0
    for token, timestamp in zip(tokens, timestamps):
        try:
            value = float(timestamp)
        except (TypeError, ValueError):
            dropped += 1
            continue
        if not math.isfinite(value) or value < 0.0 or value > chunk_duration:
            dropped += 1
            continue
        pairs.append((token, value))
    dropped += abs(len(tokens) - len(timestamps))
    return [token for token, _value in pairs], [value for _token, value in pairs], dropped


def _timestamps_are_monotonic(values) -> bool:
    return all(right >= left for left, right in zip(values, values[1:]))


def _merge_monotonic_chunk(
    merge, prev_tokens, prev_timestamps, new_tokens, new_timestamps, offset: float, overlap: float, is_first_segment: bool
):
    """Merge overlap tokens while preserving measured timestamp order.

    The upstream text matcher is useful for removing duplicated overlap text,
    but a rare ambiguous match can join a newer token before an older retained
    token.  Fall back to the measured suffix in that case.  We only remove
    overlapped tokens; no timestamp is generated or adjusted.
    """

    merged_tokens, merged_timestamps = merge(
        prev_tokens=prev_tokens,
        prev_timestamps=prev_timestamps,
        new_tokens=new_tokens,
        new_timestamps=new_timestamps,
        offset=offset,
        overlap=overlap,
        is_first_segment=is_first_segment,
    )
    if len(merged_tokens) == len(merged_timestamps) and _timestamps_are_monotonic(merged_timestamps):
        return merged_tokens, merged_timestamps, False

    global_new = [float(value) + offset for value in new_timestamps]
    last = prev_timestamps[-1] if prev_timestamps else float("-inf")
    start = next((index for index, value in enumerate(global_new) if value >= last), len(global_new))
    return prev_tokens + new_tokens[start:], prev_timestamps + global_new[start:], True


def _run(request: dict) -> dict:
    language = str(request.get("language") or "zh")
    if language.lower() not in {"zh", "zh-cn", "zh_hans"}:
        raise WorkerFailure("当前本地 Qwen3 字幕链路仅启用中文（zh）。")
    audio_path = Path(str(request.get("audio_path") or ""))
    capswriter_root = Path(str(request.get("capswriter_root") or ""))
    asr_model_dir = Path(str(request.get("model_dir") or ""))
    aligner_model_dir = Path(str(request.get("aligner_model_dir") or ""))
    if not audio_path.is_file() or not capswriter_root.is_dir() or not asr_model_dir.is_dir() or not aligner_model_dir.is_dir():
        raise WorkerFailure("本地字幕运行时、模型或受控媒体输入不可用。")

    sys.path.insert(0, str(capswriter_root.resolve()))
    active_device = str(request.get("active_device") or request.get("device") or "cpu").lower()
    provider = str(request.get("onnx_provider") or ("DML" if active_device == "dml" else "CUDA" if active_device == "cuda" else "CPU"))
    use_gpu = bool(request.get("llm_use_gpu", active_device in {"cuda", "dml"}))
    samples = _load_audio(audio_path, str(request.get("ffmpeg_path") or "ffmpeg"))
    duration = float(len(samples) / 16000.0)
    chunk_size, chunk_overlap = _chunk_settings(request)
    recognizer = None
    aligner = None
    try:
        from qwen_capswriter_backend import CapsWriterBackendError, configure_capswriter_backends

        try:
            configure_capswriter_backends(active_device=active_device, cuda_backend_dir=request.get("cuda_backend_dir"))
        except CapsWriterBackendError as exc:
            raise WorkerFailure(str(exc)) from exc
        # CUDA must be configured before importing these engines: their llama
        # wrappers bind native DLLs at module import time.
        from core.server.engines.force_aligner_gguf.align_engine import QwenForceAligner
        from core.server.engines.force_aligner_gguf.inference.schema import AlignerConfig
        from core.server.engines.qwen_asr_gguf.asr_engine import QwenASREngine
        from core.server.engines.qwen_asr_gguf.inference.schema import ASREngineConfig
        from core.server.merger import merge_by_text, merge_tokens_by_sequence_matcher, process_tokens_safely, tokens_to_text
        asr_files = _asr_files(asr_model_dir)
        aligner_files = _aligner_files(aligner_model_dir)
        recognizer = QwenASREngine(
            ASREngineConfig(
                model_dir=str(asr_model_dir),
                encoder_frontend_fn=asr_files["encoder_frontend_fn"],
                encoder_backend_fn=asr_files["encoder_backend_fn"],
                llm_fn=asr_files["llm_fn"],
                onnx_provider=provider,
                llm_use_gpu=use_gpu,
                dml_pad_to=int(chunk_size),
                chunk_size=chunk_size,
            )
        )
        aligner = QwenForceAligner(
            AlignerConfig(
                model_dir=str(aligner_model_dir),
                encoder_frontend_fn=aligner_files["encoder_frontend_fn"],
                encoder_backend_fn=aligner_files["encoder_backend_fn"],
                llm_fn=aligner_files["llm_fn"],
                onnx_provider=provider,
                llm_use_gpu=use_gpu,
                dml_pad_to=int(chunk_size),
            )
        )
        combined_text = ""
        combined_tokens: list[str] = []
        combined_timestamps: list[float] = []
        warnings: list[str] = []
        for index, (offset, chunk) in enumerate(_iter_chunks(samples, chunk_size, chunk_overlap)):
            text, tokens, timestamps = _decode_chunk(recognizer, aligner, chunk, language, combined_text[-120:])
            if text:
                combined_text = merge_by_text(combined_text, text)
            raw_tokens = process_tokens_safely(tokens)
            clean_tokens, clean_timestamps, dropped = _valid_timestamp_pairs(
                raw_tokens,
                timestamps,
                len(chunk) / 16000.0,
            )
            if dropped:
                warnings.append(f"timestamp_outside_audio_chunk_dropped:{dropped}")
            if clean_tokens and clean_timestamps:
                combined_tokens, combined_timestamps, used_fallback = _merge_monotonic_chunk(
                    merge_tokens_by_sequence_matcher,
                    combined_tokens,
                    combined_timestamps,
                    clean_tokens,
                    clean_timestamps,
                    offset,
                    chunk_overlap,
                    index == 0,
                )
                if used_fallback:
                    warnings.append("timestamp_overlap_merge_fallback: 已保留可验证的单调边界，请复核分块交界处字幕。")
        token_text = tokens_to_text(combined_tokens) if combined_tokens else ""
        if (
            not token_text.strip()
            or not combined_timestamps
            or len(combined_tokens) != len(combined_timestamps)
            or not _timestamps_are_monotonic(combined_timestamps)
        ):
            raise WorkerFailure("本地 Qwen3-ASR 未返回可用于真实时间轴的识别结果。")
        return {
            "text": token_text.strip(),
            "raw_text": combined_text.strip(),
            "tokens": combined_tokens,
            "timestamps": combined_timestamps,
            "duration_seconds": duration,
            "language": "zh",
            "model": "qwen3-asr-1.7b+qwen3-forced-aligner-0.6b",
            "warnings": list(dict.fromkeys(warnings)),
        }
    finally:
        if aligner is not None:
            aligner.cleanup()
        if recognizer is not None:
            recognizer.cleanup()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--request", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    output = Path(args.output)
    try:
        request = json.loads(Path(args.request).read_text(encoding="utf-8"))
        if not isinstance(request, dict):
            raise WorkerFailure("本地字幕请求格式无效。")
        _write(output, {"ok": True, "result": _run(request)})
        return 0
    except WorkerFailure as exc:
        _write(output, {"ok": False, "error": {"code": "TIMESTAMPED_ASR_FAILED", "message": str(exc)}})
        return 1
    except Exception:
        _write(output, {"ok": False, "error": {"code": "TIMESTAMPED_ASR_INTERNAL_ERROR", "message": "本地字幕模型出现未预期错误；请检查模型安装与运行时。"}})
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
