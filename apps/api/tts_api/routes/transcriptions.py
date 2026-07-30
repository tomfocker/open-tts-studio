"""OpenAI-style local audio transcription endpoint backed by selected local ASR."""

from fastapi import APIRouter, File, Form, HTTPException, UploadFile

from tts_api.adapters.asr import get_local_transcriber
from tts_api.config import get_settings
from tts_api.runtime_memory import local_gpu_generation_lock, release_conflicting_runtimes
from tts_api.schemas import TranscriptionResult


router = APIRouter()


@router.post("/v1/audio/transcriptions", response_model=TranscriptionResult)
def create_transcription(
    file: UploadFile = File(...),
    language: str = Form("zh"),
) -> TranscriptionResult:
    """Transcribe submitted audio locally without persisting the upload.

    The worker accepts loopback multipart bytes only; no caller-supplied file
    path is ever forwarded to it.  Running ASR is a GPU model switch just like
    a TTS request, so it shares the global local-runtime lock.
    """

    if not file.filename:
        raise HTTPException(status_code=422, detail="An audio file is required.")
    settings = get_settings()
    try:
        with local_gpu_generation_lock:
            transcriber = get_local_transcriber(settings)
            release_conflicting_runtimes(transcriber.runtime_model_id, settings)
            text = transcriber.transcribe_upload(file.file, file.filename, language=language)
        return TranscriptionResult(text=text, language=language, model=transcriber.model_name)
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail="Local audio transcription failed.") from exc
