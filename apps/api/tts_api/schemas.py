from datetime import datetime, timezone
from enum import StrEnum

from pydantic import BaseModel, Field


class CommercialUse(StrEnum):
    allowed = "allowed"
    restricted = "restricted"
    unknown = "unknown"


class ModelInfo(BaseModel):
    id: str
    display_name: str
    priority: str
    source_url: str
    code_license: str
    weights_license: str
    commercial_use: CommercialUse
    recommended_vram_gb: int = Field(ge=0)
    features: list[str]
    request_capabilities: list[str] = Field(default_factory=list)
    requires_reference_audio: bool = False
    native_sample_rate: int
    adapter: str
    internal_only: bool = False


class SpeechRequest(BaseModel):
    model: str
    input: str = Field(min_length=1)
    voice: str | None = None
    voice_prompt: str | None = None
    reference_audio: str | None = None
    reference_text: str | None = None
    emotion: str | None = None
    language: str | None = None
    response_format: str = "wav"
    speed: float = Field(default=1.0, ge=0.25, le=4.0)
    cfg: float | None = Field(default=None, ge=1.0, le=3.0)
    inference_steps: int | None = Field(default=None, ge=1, le=50)
    normalize: bool | None = None
    denoise: bool | None = None
    stream: bool = False


class SpeechResult(BaseModel):
    audio_url: str
    file_path: str
    model: str
    sample_rate: int
    duration_seconds: float


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class JobStatus(StrEnum):
    queued = "queued"
    running = "running"
    succeeded = "succeeded"
    failed = "failed"
    cancelled = "cancelled"


class TaskEvent(BaseModel):
    occurred_at: datetime = Field(default_factory=utc_now)
    stage: str
    message: str
    level: str = "info"


class JobInfo(BaseModel):
    id: str
    status: JobStatus
    request: SpeechRequest
    result: SpeechResult | None = None
    error: str | None = None
    stage: str = "queued"
    progress_percent: int = Field(default=0, ge=0, le=100)
    events: list[TaskEvent] = Field(default_factory=list)
    created_at: datetime = Field(default_factory=utc_now)
    started_at: datetime | None = None
    completed_at: datetime | None = None
    log_file: str | None = None
    retry_of: str | None = None


class TaskSummary(BaseModel):
    id: str
    source: str
    title: str
    status: str
    stage: str
    progress_percent: int = Field(ge=0, le=100)
    created_at: datetime
    updated_at: datetime
    started_at: datetime | None = None
    completed_at: datetime | None = None
    error: str | None = None
    log_file: str | None = None
    retryable: bool = False
    cancelable: bool = False
    events: list[TaskEvent] = Field(default_factory=list)


class AudioAsset(BaseModel):
    file_name: str
    file_path: str
    audio_url: str
    file_size_bytes: int = Field(ge=0)
    modified_at: datetime
    source: str = "untracked"
    model: str | None = None
    text: str | None = None
    duration_seconds: float | None = Field(default=None, ge=0)
    task_id: str | None = None
    project_id: str | None = None
    project_title: str | None = None


class VoiceInfo(BaseModel):
    id: str
    name: str
    reference_audio: str | None = None
    reference_text: str | None = None
    authorization_status: str
    source_type: str = "local_import"
    source_url: str | None = None


class CreateVoiceRequest(BaseModel):
    name: str = Field(min_length=1)
    reference_audio: str | None = None
    reference_text: str | None = None
    authorization_status: str
    source_type: str = Field(default="local_import", max_length=80)
    source_url: str | None = Field(default=None, max_length=2000)


class VoiceQualityStatus(StrEnum):
    ready = "ready"
    warning = "warning"
    error = "error"
    unknown = "unknown"


class VoiceQualityReport(BaseModel):
    voice_id: str
    reference_audio: str | None = None
    exists: bool = False
    readable: bool | None = None
    format: str | None = None
    file_size_bytes: int | None = None
    duration_seconds: float | None = None
    sample_rate: int | None = None
    channels: int | None = None
    analyzed_seconds: float | None = None
    silence_ratio: float | None = None
    status: VoiceQualityStatus = VoiceQualityStatus.unknown
    warnings: list[str] = Field(default_factory=list)


class BatchProjectStatus(StrEnum):
    draft = "draft"
    queued = "queued"
    running = "running"
    cancelling = "cancelling"
    cancelled = "cancelled"
    completed = "completed"
    failed = "failed"


class BatchSegmentStatus(StrEnum):
    pending = "pending"
    running = "running"
    succeeded = "succeeded"
    failed = "failed"
class BatchSegmentDraft(BaseModel):
    text: str = Field(min_length=1, max_length=5000)


class BatchSegment(BatchSegmentDraft):
    id: str
    position: int
    status: BatchSegmentStatus = BatchSegmentStatus.pending
    attempts: int = 0
    result: SpeechResult | None = None
    error: str | None = None


class BatchProjectCreate(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    model: str = Field(min_length=1)
    segments: list[BatchSegmentDraft] = Field(min_length=1, max_length=500)
    reference_audio: str | None = None
    reference_text: str | None = None
    emotion: str | None = None
    speed: float = Field(default=1.0, ge=0.25, le=4.0)
    cfg: float | None = Field(default=None, ge=1.0, le=3.0)
    inference_steps: int | None = Field(default=None, ge=1, le=50)
    normalize: bool | None = None
    denoise: bool | None = None


class BatchProjectUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=120)
    model: str | None = Field(default=None, min_length=1)
    segments: list[BatchSegmentDraft] | None = Field(default=None, min_length=1, max_length=500)
    reference_audio: str | None = None
    reference_text: str | None = None
    emotion: str | None = None
    speed: float | None = Field(default=None, ge=0.25, le=4.0)
    cfg: float | None = Field(default=None, ge=1.0, le=3.0)
    inference_steps: int | None = Field(default=None, ge=1, le=50)
    normalize: bool | None = None
    denoise: bool | None = None


class BatchProject(BaseModel):
    id: str
    title: str
    model: str
    segments: list[BatchSegment]
    reference_audio: str | None = None
    reference_text: str | None = None
    emotion: str | None = None
    speed: float = 1.0
    cfg: float | None = None
    inference_steps: int | None = None
    normalize: bool | None = None
    denoise: bool | None = None
    status: BatchProjectStatus = BatchProjectStatus.draft
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)
    started_at: datetime | None = None
    completed_at: datetime | None = None

    @property
    def progress(self) -> tuple[int, int]:
        finished = sum(segment.status == BatchSegmentStatus.succeeded for segment in self.segments)
        return finished, len(self.segments)
