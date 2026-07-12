from uuid import uuid4

from tts_api.schemas import JobInfo, JobStatus, SpeechRequest, SpeechResult


class JobStore:
    def __init__(self):
        self._jobs: dict[str, JobInfo] = {}

    def create(self, request: SpeechRequest) -> JobInfo:
        job = JobInfo(id=uuid4().hex, status=JobStatus.queued, request=request)
        self._jobs[job.id] = job
        return job

    def mark_running(self, job_id: str) -> JobInfo:
        job = self._jobs[job_id]
        updated = job.model_copy(update={"status": JobStatus.running})
        self._jobs[job_id] = updated
        return updated

    def mark_succeeded(self, job_id: str, result: SpeechResult) -> JobInfo:
        job = self._jobs[job_id]
        updated = job.model_copy(update={"status": JobStatus.succeeded, "result": result})
        self._jobs[job_id] = updated
        return updated

    def mark_failed(self, job_id: str, error: str) -> JobInfo:
        job = self._jobs[job_id]
        updated = job.model_copy(update={"status": JobStatus.failed, "error": error})
        self._jobs[job_id] = updated
        return updated

    def get(self, job_id: str) -> JobInfo | None:
        return self._jobs.get(job_id)


job_store = JobStore()
