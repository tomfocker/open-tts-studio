from fastapi import APIRouter, HTTPException

from tts_api.jobs import job_store
from tts_api.routes.speech import synthesize_with_registered_adapter
from tts_api.schemas import JobInfo, SpeechRequest

router = APIRouter()


@router.post("/v1/tts/jobs", response_model=JobInfo)
def create_job(request: SpeechRequest) -> JobInfo:
    job = job_store.create(request)
    job_store.mark_running(job.id)
    try:
        result = synthesize_with_registered_adapter(request)
    except Exception as exc:
        return job_store.mark_failed(job.id, str(exc))
    return job_store.mark_succeeded(job.id, result)


@router.get("/v1/tts/jobs/{job_id}", response_model=JobInfo)
def get_job(job_id: str) -> JobInfo:
    job = job_store.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail=f"Unknown job: {job_id}")
    return job
