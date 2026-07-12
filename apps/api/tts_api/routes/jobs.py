from fastapi import APIRouter, HTTPException

from tts_api.jobs import get_job_runner, get_job_store
from tts_api.schemas import JobInfo, SpeechRequest

router = APIRouter()


@router.post("/v1/tts/jobs", response_model=JobInfo)
def create_job(request: SpeechRequest) -> JobInfo:
    try:
        return get_job_runner().enqueue(request)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"无法创建本地生成任务：{exc}")


@router.get("/v1/tts/jobs", response_model=list[JobInfo])
def list_jobs() -> list[JobInfo]:
    return get_job_store().list()


@router.get("/v1/tts/jobs/{job_id}", response_model=JobInfo)
def get_job(job_id: str) -> JobInfo:
    job = get_job_store().get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail=f"Unknown job: {job_id}")
    return job


@router.post("/v1/tts/jobs/{job_id}/cancel", response_model=JobInfo)
def cancel_job(job_id: str) -> JobInfo:
    try:
        return get_job_runner().cancel(job_id)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"Unknown job: {job_id}")
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc))


@router.post("/v1/tts/jobs/{job_id}/retry", response_model=JobInfo)
def retry_job(job_id: str) -> JobInfo:
    try:
        return get_job_runner().retry(job_id)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"Unknown job: {job_id}")
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
