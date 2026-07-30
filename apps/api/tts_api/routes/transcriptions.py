"""OpenAI-style one-shot ASR plus managed local audio/video transcription jobs."""

from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import PlainTextResponse

from tts_api.adapters.asr import get_local_transcriber
from tts_api.config import get_settings
from tts_api.runtime_memory import local_gpu_generation_lock, release_conflicting_runtimes
from tts_api.schemas import TranscriptionInputInfo, TranscriptionJobInfo, TranscriptionJobRequest, TranscriptionResult
from tts_api.transcription import TranscriptionError, generate_srt, get_transcription_runner, get_transcription_store


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


@router.post("/v1/transcriptions/uploads", response_model=TranscriptionInputInfo)
async def upload_transcription_input(file: UploadFile = File(...)) -> TranscriptionInputInfo:
    """Stage an API-uploaded file under the local controlled input directory.

    Desktop clients normally stage through Electron's main process to avoid
    moving large videos through the renderer.  This endpoint keeps the local
    HTTP API useful for other loopback callers without accepting file paths.
    """

    if not file.filename:
        raise HTTPException(status_code=422, detail="An audio or video file is required.")
    original_name = Path(file.filename).name
    if not original_name or original_name != file.filename or not Path(original_name).suffix:
        raise HTTPException(status_code=422, detail="媒体文件名无效。")
    settings = get_settings()
    input_id = uuid4().hex
    target = settings.transcription_input_dir / f"{input_id}{Path(original_name).suffix.lower()[:16]}"
    temporary = target.with_suffix(f"{target.suffix}.part")
    written = 0
    try:
        settings.transcription_input_dir.mkdir(parents=True, exist_ok=True)
        with temporary.open("wb") as handle:
            while chunk := await file.read(1024 * 1024):
                written += len(chunk)
                if written > settings.transcription_max_input_bytes:
                    raise HTTPException(status_code=413, detail="媒体文件超过本地转写允许的大小。")
                handle.write(chunk)
        if written <= 0:
            raise HTTPException(status_code=422, detail="媒体文件为空。")
        temporary.replace(target)
        return TranscriptionInputInfo(id=input_id, file_name=original_name, file_size_bytes=written)
    except HTTPException:
        raise
    except OSError as exc:
        raise HTTPException(status_code=500, detail="无法保存本地媒体导入文件。") from exc
    finally:
        try:
            temporary.unlink(missing_ok=True)
        except OSError:
            pass
        await file.close()


@router.post("/v1/transcriptions", response_model=TranscriptionJobInfo)
def create_transcription_job(request: TranscriptionJobRequest) -> TranscriptionJobInfo:
    try:
        return get_transcription_runner().enqueue(request)
    except TranscriptionError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail="无法创建本地音视频转写任务。") from exc


@router.get("/v1/transcriptions", response_model=list[TranscriptionJobInfo])
def list_transcription_jobs() -> list[TranscriptionJobInfo]:
    return get_transcription_store().list()


@router.get("/v1/transcriptions/{job_id}", response_model=TranscriptionJobInfo)
def get_transcription_job(job_id: str) -> TranscriptionJobInfo:
    job = get_transcription_store().get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Unknown transcription job")
    return job


@router.post("/v1/transcriptions/{job_id}/cancel", response_model=TranscriptionJobInfo)
def cancel_transcription_job(job_id: str, force: bool = False) -> TranscriptionJobInfo:
    try:
        return get_transcription_runner().cancel(job_id, force_running=force)
    except KeyError:
        raise HTTPException(status_code=404, detail="Unknown transcription job")
    except TranscriptionError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.post("/v1/transcriptions/{job_id}/retry", response_model=TranscriptionJobInfo)
def retry_transcription_job(job_id: str) -> TranscriptionJobInfo:
    try:
        return get_transcription_runner().retry(job_id)
    except KeyError:
        raise HTTPException(status_code=404, detail="Unknown transcription job")
    except TranscriptionError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.get("/v1/transcriptions/{job_id}/export.txt", response_class=PlainTextResponse)
def export_transcription_txt(job_id: str) -> PlainTextResponse:
    job = get_transcription_store().get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Unknown transcription job")
    if job.status.value != "completed" or not job.text:
        raise HTTPException(status_code=409, detail="转写尚未完成，无法导出 TXT。")
    return PlainTextResponse(
        job.text,
        headers={"Content-Disposition": 'attachment; filename="transcription.txt"'},
        media_type="text/plain; charset=utf-8",
    )


@router.get("/v1/transcriptions/{job_id}/export.srt", response_class=PlainTextResponse)
def export_transcription_srt(job_id: str) -> PlainTextResponse:
    job = get_transcription_store().get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Unknown transcription job")
    try:
        content = generate_srt(job)
    except TranscriptionError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return PlainTextResponse(
        content,
        headers={"Content-Disposition": 'attachment; filename="subtitles.srt"'},
        media_type="application/x-subrip; charset=utf-8",
    )
