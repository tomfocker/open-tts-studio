"""Loopback API for managed local speech-enhancement comparison jobs."""

from __future__ import annotations

from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, File, HTTPException, UploadFile

from tts_api.config import get_settings
from tts_api.enhancement import AudioEnhancementError, get_audio_enhancement_runner, get_audio_enhancement_store
from tts_api.schemas import AudioEnhancementInputInfo, AudioEnhancementJobInfo, AudioEnhancementJobRequest


router = APIRouter()


@router.post("/v1/audio-enhancements/uploads", response_model=AudioEnhancementInputInfo)
async def upload_audio_enhancement_input(file: UploadFile = File(...)) -> AudioEnhancementInputInfo:
    """Stage a media file without ever accepting a caller-provided path."""

    if not file.filename:
        raise HTTPException(status_code=422, detail="An audio or video file is required.")
    source_file_name = Path(file.filename).name
    if not source_file_name or source_file_name != file.filename or not Path(source_file_name).suffix:
        raise HTTPException(status_code=422, detail="媒体文件名无效。")
    settings = get_settings()
    input_id = uuid4().hex
    suffix = Path(source_file_name).suffix.lower()[:16]
    target = settings.audio_enhancement_input_dir / f"{input_id}{suffix}"
    temporary = target.with_suffix(f"{target.suffix}.part")
    written = 0
    try:
        settings.audio_enhancement_input_dir.mkdir(parents=True, exist_ok=True)
        with temporary.open("wb") as handle:
            while chunk := await file.read(1024 * 1024):
                written += len(chunk)
                if written > settings.transcription_max_input_bytes:
                    raise HTTPException(status_code=413, detail="媒体文件超过本地语音增强允许的大小。")
                handle.write(chunk)
        if written <= 0:
            raise HTTPException(status_code=422, detail="媒体文件为空。")
        temporary.replace(target)
        return AudioEnhancementInputInfo(id=input_id, file_name=source_file_name, file_size_bytes=written)
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


@router.post("/v1/audio-enhancements", response_model=AudioEnhancementJobInfo)
def create_audio_enhancement_job(request: AudioEnhancementJobRequest) -> AudioEnhancementJobInfo:
    try:
        return get_audio_enhancement_runner().enqueue(request)
    except AudioEnhancementError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail="无法创建本地语音增强任务。") from exc


@router.get("/v1/audio-enhancements", response_model=list[AudioEnhancementJobInfo])
def list_audio_enhancement_jobs() -> list[AudioEnhancementJobInfo]:
    return get_audio_enhancement_store().list()


@router.get("/v1/audio-enhancements/{job_id}", response_model=AudioEnhancementJobInfo)
def get_audio_enhancement_job(job_id: str) -> AudioEnhancementJobInfo:
    job = get_audio_enhancement_store().get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Unknown audio enhancement job")
    return job


@router.post("/v1/audio-enhancements/{job_id}/cancel", response_model=AudioEnhancementJobInfo)
def cancel_audio_enhancement_job(job_id: str, force: bool = False) -> AudioEnhancementJobInfo:
    try:
        return get_audio_enhancement_runner().cancel(job_id, force_running=force)
    except KeyError:
        raise HTTPException(status_code=404, detail="Unknown audio enhancement job")
    except AudioEnhancementError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.post("/v1/audio-enhancements/{job_id}/retry", response_model=AudioEnhancementJobInfo)
def retry_audio_enhancement_job(job_id: str) -> AudioEnhancementJobInfo:
    try:
        return get_audio_enhancement_runner().retry(job_id)
    except KeyError:
        raise HTTPException(status_code=404, detail="Unknown audio enhancement job")
    except AudioEnhancementError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
