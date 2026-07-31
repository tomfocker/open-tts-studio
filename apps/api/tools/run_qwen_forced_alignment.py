"""Offline Qwen3-ForcedAligner worker for OpenTTS.

The Qwen runtime and its ONNX/GGUF models are supplied as explicit local paths
by the parent process. No inference input is sent to a remote service. The
formal TTS text is passed directly to ``QwenForceAligner.align`` to create the
timeline from the final audio waveform.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path


class WorkerFailure(RuntimeError):
    pass


def _write(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def _fail(path: Path, code: str, message: str) -> int:
    _write(path, {"ok": False, "error": {"code": code, "message": message}})
    return 1


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
        raise WorkerFailure("无法用本地 ffmpeg 解码最终音频。")
    samples = np.frombuffer(completed.stdout, dtype=np.float32)
    if len(samples) < 400:
        raise WorkerFailure("最终音频过短，无法进行可靠的强制对齐。")
    return samples


def _pick_file(model_dir: Path, preferred: list[str], pattern: str, label: str) -> str:
    for name in preferred:
        if (model_dir / name).is_file():
            return name
    matches = sorted(model_dir.glob(pattern), key=lambda path: path.name)
    if matches:
        return matches[0].name
    raise WorkerFailure(f"本地 {label} 模型文件不完整。")


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


def _visible_token(text: str) -> str:
    return str(text or "").replace("@@", "").strip()


def _is_punctuation(text: str) -> bool:
    return bool(text) and all(re.match(r"[，。！？；：、,.!?;:…'\"“”‘’()（）\[\]【】]", char) for char in text)


def _map_items_to_transcript(items, transcript: str, duration: float) -> list[dict]:
    """Keep original character indices while preserving only model boundaries."""

    tokens: list[dict] = []
    search_from = 0
    previous_end = 0.0
    unmatched: list[str] = []
    for item in items:
        text = _visible_token(getattr(item, "text", ""))
        if not text:
            continue
        # The upstream reconciler gives punctuation a nearby visual timestamp,
        # which can overlap adjacent speech.  It has no acoustic token of its
        # own, so keep it in the containing segment but never claim it is a
        # separately aligned spoken token.
        if _is_punctuation(text):
            continue
        char_start = transcript.find(text, search_from)
        if char_start < 0:
            unmatched.append(text)
            continue
        char_end = char_start + len(text)
        start = float(getattr(item, "start_time", -1))
        end = float(getattr(item, "end_time", -1))
        if start < 0 or end < start or end > duration + 1e-6:
            raise WorkerFailure("强制对齐器返回了非单调或超出最终音频的时间戳。")
        if start < previous_end - 1e-6:
            # Qwen timestamps have an 80 ms grid.  Adjacent Chinese characters
            # can therefore share/overlap one acoustic interval.  Preserve the
            # real interval by making them one model-token entry; never invent
            # a sub-token split just to make a prettier timeline.
            previous = tokens[-1] if tokens else None
            if previous is None or char_start != previous["char_end"]:
                raise WorkerFailure("强制对齐器返回了无法合并的重叠语音 token。")
            previous["text"] += text
            previous["char_end"] = char_end
            previous["end_seconds"] = round(max(previous["end_seconds"], end), 6)
        else:
            tokens.append(
                {
                    "text": text,
                    "char_start": char_start,
                    "char_end": char_end,
                    "start_seconds": round(start, 6),
                    "end_seconds": round(end, 6),
                    "confidence": None,
                }
            )
            previous_end = end
        search_from = char_end
    if unmatched:
        raise WorkerFailure(f"强制对齐器没有返回原文 token：{''.join(unmatched[:10])}")
    if not tokens:
        raise WorkerFailure("强制对齐器没有返回可用 token。")
    # The normal Qwen reconciler returns punctuation too.  Require every
    # voiced character in the original text to be represented; this prevents a
    # successful-looking timeline when the requested narration was omitted.
    covered = {index for token in tokens for index in range(token["char_start"], token["char_end"])}
    missing = [
        char
        for index, char in enumerate(transcript)
        if not char.isspace() and not _is_punctuation(char) and index not in covered
    ]
    if missing:
        raise WorkerFailure(f"强制对齐未覆盖正式原文中的字符：{''.join(missing[:10])}")
    return tokens


def _segments(transcript: str, tokens: list[dict]) -> list[dict]:
    boundaries = set("，。！？；、,.!?;")
    end_offsets: list[int] = []
    last_start = 0
    for index, char in enumerate(transcript):
        next_is_punctuation = index + 1 < len(transcript) and transcript[index + 1] in boundaries
        # Do not split immediately before punctuation.  Punctuation has no
        # standalone acoustic token and belongs to the preceding subtitle.
        if char in boundaries or (index - last_start >= 11 and not next_is_punctuation):
            end_offsets.append(index + 1)
            last_start = index + 1
    if not end_offsets or end_offsets[-1] < len(transcript):
        end_offsets.append(len(transcript))
    output: list[dict] = []
    start_offset = 0
    token_index = 0
    for number, end_offset in enumerate(end_offsets, start=1):
        group: list[dict] = []
        while token_index < len(tokens) and tokens[token_index]["char_start"] < end_offset:
            if tokens[token_index]["char_end"] > start_offset:
                group.append(tokens[token_index])
            token_index += 1
        if group:
            output.append(
                {
                    "id": f"seg_{number:03d}",
                    "text": transcript[start_offset:end_offset],
                    "char_start": start_offset,
                    "char_end": end_offset,
                    "start_seconds": group[0]["start_seconds"],
                    "end_seconds": group[-1]["end_seconds"],
                    "confidence": None,
                }
            )
        start_offset = end_offset
    return output


def _align(samples, transcript: str, aligner_model_dir: Path, provider: str, use_gpu: bool, language: str):
    from core.server.engines.force_aligner_gguf.align_engine import QwenForceAligner
    from core.server.engines.force_aligner_gguf.inference.schema import AlignerConfig

    files = _aligner_files(aligner_model_dir)
    aligner = QwenForceAligner(
        AlignerConfig(
            model_dir=str(aligner_model_dir),
            encoder_frontend_fn=files["encoder_frontend_fn"],
            encoder_backend_fn=files["encoder_backend_fn"],
            llm_fn=files["llm_fn"],
            onnx_provider=provider,
            llm_use_gpu=use_gpu,
            dml_pad_to=60,
        )
    )
    try:
        return aligner.align(audio=samples, text=transcript, language=language, offset_sec=0.0)
    finally:
        aligner.cleanup()


def _run(request: dict) -> dict:
    language = str(request.get("language") or "zh")
    if language.lower() not in {"zh", "zh-cn", "zh_hans"}:
        raise WorkerFailure("当前本地 Qwen 强制对齐配置仅启用中文（zh）。")
    capswriter_root = Path(str(request.get("capswriter_root") or ""))
    aligner_model_dir = Path(str(request.get("aligner_model_dir") or ""))
    audio_path = Path(str(request.get("audio_path") or ""))
    if not capswriter_root.is_dir() or not aligner_model_dir.is_dir() or not audio_path.is_file():
        raise WorkerFailure("本地 Qwen 对齐运行时、模型或最终音频不存在。")
    sys.path.insert(0, str(capswriter_root.resolve()))
    duration = float(request.get("duration_seconds") or 0)
    if duration <= 0:
        raise WorkerFailure("最终音频探测时长无效。")
    active_device = str(request.get("active_device") or request.get("device") or "cpu").lower()
    provider = str(request.get("onnx_provider") or ("DML" if active_device == "dml" else "CUDA" if active_device == "cuda" else "CPU"))
    use_gpu = bool(request.get("llm_use_gpu", active_device in {"cuda", "dml"}))
    samples = _load_audio(audio_path, str(request.get("ffmpeg_path") or "ffmpeg"))
    transcript = str(request.get("transcript") or "")
    if not transcript.strip():
        raise WorkerFailure("正式原文为空，无法进行强制对齐。")

    warnings = ["token_confidence_unavailable: qwen3-forced-aligner exposes real boundaries but no calibrated per-token confidence"]

    try:
        from qwen_capswriter_backend import CapsWriterBackendError, configure_capswriter_backends

        configure_capswriter_backends(active_device=active_device, cuda_backend_dir=request.get("cuda_backend_dir"))
    except CapsWriterBackendError as exc:
        raise WorkerFailure(str(exc)) from exc
    aligned = _align(samples, transcript, aligner_model_dir, provider, use_gpu, language)
    raw_items = list(getattr(aligned, "items", []) or [])
    tokens = _map_items_to_transcript(raw_items, transcript, duration)
    segments = _segments(transcript, tokens)
    if not segments:
        raise WorkerFailure("强制对齐没有生成短句片段。")
    return {
        "version": 1,
        "language": "zh",
        "audio_sha256": str(request["audio_sha256"]),
        "transcript_sha256": str(request["transcript_sha256"]),
        "model_version": str(request["model_version"]),
        "duration_seconds": duration,
        "segments": segments,
        "tokens": tokens,
        "words": tokens if str(request.get("granularity")) == "word" else None,
        "warnings": warnings,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--request", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    output = Path(args.output)
    try:
        request = json.loads(Path(args.request).read_text(encoding="utf-8"))
        if not isinstance(request, dict):
            raise WorkerFailure("本地对齐请求格式无效。")
        _write(output, {"ok": True, "alignment": _run(request)})
        return 0
    except WorkerFailure as exc:
        return _fail(output, "ALIGNMENT_FAILED", str(exc))
    except Exception:
        return _fail(output, "ALIGNMENT_INTERNAL_ERROR", "本地 Qwen 强制对齐出现未预期错误。请检查模型安装与任务日志。")


if __name__ == "__main__":
    raise SystemExit(main())
