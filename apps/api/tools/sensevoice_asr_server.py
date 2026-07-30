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
import threading
from pathlib import Path
from tempfile import NamedTemporaryFile

import uvicorn
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from funasr import AutoModel


MAX_AUDIO_BYTES = 256 * 1024 * 1024


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


def create_app(model_dir: Path, device: str, work_dir: Path) -> FastAPI:
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
                text = _transcript(model.generate(input=str(temporary_path), language=language, use_itn=use_itn))
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
    app = create_app(Path(args.model_dir), args.device, Path(args.work_dir))
    uvicorn.run(app, host=args.host, port=args.port, log_level="warning", access_log=False)


if __name__ == "__main__":
    main()
