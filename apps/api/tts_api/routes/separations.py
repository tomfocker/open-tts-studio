"""Loopback API for local, managed MDX-Net audio-separation jobs."""

from __future__ import annotations

from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, File, HTTPException, UploadFile

from tts_api.config import get_settings
from tts_api.separation import (
    AudioSeparationError,
    AudioSeparationInputInfo,
    AudioSeparationJobInfo,
    AudioSeparationJobRequest,
    _paths,
    get_audio_separation_runner,
    get_audio_separation_store,
)


router = APIRouter()


@router.post("/v1/audio-separations/uploads", response_model=AudioSeparationInputInfo)
async def upload_audio_separation_input(file: UploadFile = File(...)) -> AudioSeparationInputInfo:
    if not file.filename:
        raise HTTPException(status_code=422, detail="需要一个音频或视频文件。")
    source_file_name = Path(file.filename).name
    if not source_file_name or source_file_name != file.filename or not Path(source_file_name).suffix:
        raise HTTPException(status_code=422, detail="媒体文件名无效。")
    settings = get_settings()
    target_root = _paths(settings).inputs
    input_id = uuid4().hex
    suffix = Path(source_file_name).suffix.lower()[:16]
    target = target_root / f"{input_id}{suffix}"
    temporary = target.with_suffix(f"{target.suffix}.part")
    written = 0
    try:
        target_root.mkdir(parents=True, exist_ok=True)
        with temporary.open("wb") as handle:
            while chunk := await file.read(1024 * 1024):
                written += len(chunk)
                if written > settings.transcription_max_input_bytes:
                    raise HTTPException(status_code=413, detail="媒体文件超过本地分轨允许的大小。")
                handle.write(chunk)
        if written <= 0:
            raise HTTPException(status_code=422, detail="媒体文件为空。")
        temporary.replace(target)
        return AudioSeparationInputInfo(id=input_id, file_name=source_file_name, file_size_bytes=written)
    except HTTPException:
        raise
    except OSError as exc:
        raise HTTPException(status_code=500, detail="无法保存本地媒体导入文件。") from exc
    finally:
        temporary.unlink(missing_ok=True)
        await file.close()


@router.post("/v1/audio-separations", response_model=AudioSeparationJobInfo)
def create_audio_separation_job(request: AudioSeparationJobRequest) -> AudioSeparationJobInfo:
    try:
        return get_audio_separation_runner().enqueue(request)
    except AudioSeparationError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail="无法创建本地音频分轨任务。") from exc


@router.get("/v1/audio-separations", response_model=list[AudioSeparationJobInfo])
def list_audio_separation_jobs() -> list[AudioSeparationJobInfo]:
    return get_audio_separation_store().list()


@router.get("/v1/audio-separations/{job_id}", response_model=AudioSeparationJobInfo)
def get_audio_separation_job(job_id: str) -> AudioSeparationJobInfo:
    job = get_audio_separation_store().get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Unknown audio separation job")
    return job


@router.post("/v1/audio-separations/{job_id}/cancel", response_model=AudioSeparationJobInfo)
def cancel_audio_separation_job(job_id: str, force: bool = False) -> AudioSeparationJobInfo:
    try:
        return get_audio_separation_runner().cancel(job_id, force_running=force)
    except KeyError:
        raise HTTPException(status_code=404, detail="Unknown audio separation job")
    except AudioSeparationError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.post("/v1/audio-separations/{job_id}/retry", response_model=AudioSeparationJobInfo)
def retry_audio_separation_job(job_id: str) -> AudioSeparationJobInfo:
    try:
        return get_audio_separation_runner().retry(job_id)
    except KeyError:
        raise HTTPException(status_code=404, detail="Unknown audio separation job")
    except AudioSeparationError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
