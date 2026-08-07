"""Loopback-only, offline SenseVoice transcription service.

This process deliberately has no dependency on any TTS model or API.  It is
started by OpenTTS with explicit local model/runtime paths and receives audio
over localhost multipart HTTP.  Uploaded bytes are written to a random
temporary file only for FunASR decoding and are removed before the response is
sent.  No transcript, filename, audio path, or reference-voice material is
logged or persisted by this worker.
"""

from __future__ import annotations

import argparse
import os
import subprocess
import threading
from pathlib import Path
from tempfile import NamedTemporaryFile

import numpy as np
import uvicorn
from fastapi import FastAPI, File, Form, HTTPException, UploadFile


MAX_AUDIO_BYTES = 256 * 1024 * 1024
SAMPLE_RATE = 16_000
# SenseVoice's reference pipeline uses VAD to keep each model input bounded.
# The installed package intentionally does not ship a second VAD model, so
# keep the same protection with an ffmpeg-backed sliding window.  The overlap
# prevents words straddling a boundary from disappearing; the merge below
# removes an exact repeated suffix/prefix when the model hears it twice.
CHUNK_SECONDS = 30
OVERLAP_SECONDS = 1.5


def _read_up_to(stream, size: int) -> bytes:
    chunks: list[bytes] = []
    remaining = size
    while remaining > 0:
        block = stream.read(remaining)
        if not block:
            break
        chunks.append(block)
        remaining -= len(block)
    return b"".join(chunks)


def _iter_audio_chunks(audio_path: Path, ffmpeg_path: str | Path, *, chunk_seconds: int = CHUNK_SECONDS, overlap_seconds: float = OVERLAP_SECONDS):
    """Decode any media to bounded 16 kHz mono windows without loading it all."""

    chunk_samples = max(1, int(chunk_seconds * SAMPLE_RATE))
    overlap_samples = min(max(0, int(overlap_seconds * SAMPLE_RATE)), chunk_samples - 1)
    chunk_bytes = chunk_samples * 4
    body_bytes = max(4, (chunk_samples - overlap_samples) * 4)
    process = subprocess.Popen(
        [
            str(ffmpeg_path),
            "-nostdin",
            "-v",
            "error",
            "-i",
            str(audio_path),
            "-map",
            "0:a:0",
            "-f",
            "f32le",
            "-ac",
            "1",
            "-ar",
            str(SAMPLE_RATE),
            "-",
        ],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    try:
        if process.stdout is None:
            raise RuntimeError("无法读取媒体音轨。")
        raw = _read_up_to(process.stdout, chunk_bytes)
        while raw:
            usable = len(raw) - (len(raw) % 4)
            if usable <= 0:
                break
            yield np.frombuffer(raw[:usable], dtype=np.float32).copy()
            if len(raw) < chunk_bytes:
                break
            tail = raw[-overlap_samples * 4 :] if overlap_samples else b""
            body = _read_up_to(process.stdout, body_bytes)
            if not body:
                break
            raw = tail + body
        return_code = process.wait()
        if return_code != 0:
            detail = process.stderr.read().decode("utf-8", errors="replace").strip() if process.stderr else ""
            raise RuntimeError(f"媒体音轨解码失败：{detail[:300]}")
    finally:
        if process.poll() is None:
            process.terminate()
            process.wait(timeout=5)
        if process.stdout:
            process.stdout.close()
        if process.stderr:
            process.stderr.close()


def _merge_chunk_text(previous: str, current: str, language: str) -> str:
    previous = previous.strip()
    current = current.strip()
    if not previous:
        return current
    if not current:
        return previous
    # Only remove an overlap that is exactly present in both outputs.  This
    # avoids deleting a legitimate repeated phrase merely because it sounds
    # similar at a chunk boundary.
    max_overlap = min(80, len(previous), len(current))
    for overlap in range(max_overlap, 1, -1):
        if previous[-overlap:] == current[:overlap]:
            return previous + current[overlap:]
    separator = "" if language.lower().startswith(("zh", "yue", "ja", "ko")) else " "
    return previous + separator + current


def _transcribe_media(model, audio_path: Path, language: str, use_itn: bool, ffmpeg_path: str | Path) -> str:
    texts: list[str] = []
    for samples in _iter_audio_chunks(audio_path, ffmpeg_path):
        raw_result = model.generate(
            input=samples,
            fs=SAMPLE_RATE,
            language=language,
            use_itn=use_itn,
            batch_size_s=CHUNK_SECONDS,
            disable_pbar=True,
        )
        try:
            text = _transcript(raw_result)
        except ValueError:
            # A final window containing only silence is not a failed job; the
            # preceding windows still contain valid speech and must be kept.
            continue
        if text:
            texts.append(text)
    merged = ""
    for text in texts:
        merged = _merge_chunk_text(merged, text, language)
    if not merged:
        raise ValueError("SenseVoice returned an empty transcript")
    return merged


def _device(value: str) -> str:
    if value == "cuda":
        return "cuda:0"
    if value == "cpu":
        return "cpu"
    try:
        import torch

        return "cuda:0" if torch.cuda.is_available() else "cpu"
    except Exception:
        return "cpu"


def _transcript(raw_result: object) -> str:
    if not isinstance(raw_result, list) or not raw_result or not isinstance(raw_result[0], dict):
        raise ValueError("SenseVoice did not return a usable transcript")
    text = str(raw_result[0].get("text") or "").split("|>")[-1].strip()
    if not text:
        raise ValueError("SenseVoice returned an empty transcript")
    return text


def create_app(model_dir: Path, device: str, work_dir: Path, ffmpeg_path: Path | None = None) -> FastAPI:
    from funasr import AutoModel

    if not model_dir.is_dir():
        raise FileNotFoundError("SenseVoice local model directory is unavailable")
    work_dir.mkdir(parents=True, exist_ok=True)
    model = AutoModel(model=str(model_dir), disable_update=True, log_level="ERROR", device=_device(device))
    model_lock = threading.Lock()
    app = FastAPI(title="OpenTTS Local SenseVoice ASR", version="1")

    @app.get("/health")
    async def health() -> dict[str, object]:
        return {"status": "ok", "backend": "sensevoice-small", "model_loaded": True}

    @app.post("/transcribe")
    async def transcribe(
        audio: UploadFile = File(...),
        language: str = Form("zh"),
        use_itn: bool = Form(True),
    ) -> dict[str, str]:
        suffix = Path(audio.filename or "audio.wav").suffix.lower()
        if not suffix or len(suffix) > 10:
            suffix = ".wav"
        temporary_path: Path | None = None
        try:
            total = 0
            with NamedTemporaryFile(dir=work_dir, suffix=suffix, delete=False) as temporary:
                temporary_path = Path(temporary.name)
                while chunk := await audio.read(1024 * 1024):
                    total += len(chunk)
                    if total > MAX_AUDIO_BYTES:
                        raise ValueError("audio payload exceeds the local ASR size limit")
                    temporary.write(chunk)
            if total == 0:
                raise ValueError("audio payload is empty")
            # FunASR's CUDA model object is not safe for concurrent generation.
            # Serialising here also makes the external manager's active-request
            # accounting a truthful representation of GPU use.
            with model_lock:
                text = _transcribe_media(
                    model,
                    temporary_path,
                    language,
                    use_itn,
                    ffmpeg_path or "ffmpeg",
                )
            return {"text": text, "language": language, "model": "sensevoice-small"}
        except HTTPException:
            raise
        except Exception as exc:
            # Do not include a local filename, request data, or runtime command
            # line in an HTTP response.  The parent converts this to its own
            # safe task warning/error when used by alignment.
            raise HTTPException(status_code=422, detail="Local SenseVoice transcription failed") from exc
        finally:
            await audio.close()
            if temporary_path is not None:
                temporary_path.unlink(missing_ok=True)

    return app


def main() -> None:
    parser = argparse.ArgumentParser(description="Run OpenTTS local SenseVoice ASR service")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, required=True)
    parser.add_argument("--model-dir", required=True)
    parser.add_argument("--device", choices=["auto", "cuda", "cpu"], default="auto")
    parser.add_argument("--work-dir", required=True)
    parser.add_argument("--ffmpeg-path", default="ffmpeg")
    args = parser.parse_args()

    # Defence in depth: an accidental model identifier must never trigger an
    # update/download path in the separate runtime.
    os.environ.update(
        {
            "HF_HUB_OFFLINE": "1",
            "TRANSFORMERS_OFFLINE": "1",
            "HF_HUB_DISABLE_TELEMETRY": "1",
            "MODELSCOPE_OFFLINE": "1",
            "PYTHONUTF8": "1",
        }
    )
    app = create_app(Path(args.model_dir), args.device, Path(args.work_dir), Path(args.ffmpeg_path))
    uvicorn.run(app, host=args.host, port=args.port, log_level="warning", access_log=False)


if __name__ == "__main__":
    main()
