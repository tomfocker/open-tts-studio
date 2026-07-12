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
    stream: bool = False


class SpeechResult(BaseModel):
    audio_url: str
    file_path: str
    model: str
    sample_rate: int
    duration_seconds: float


class JobStatus(StrEnum):
    queued = "queued"
    running = "running"
    succeeded = "succeeded"
    failed = "failed"


class JobInfo(BaseModel):
    id: str
    status: JobStatus
    request: SpeechRequest
    result: SpeechResult | None = None
    error: str | None = None


class VoiceInfo(BaseModel):
    id: str
    name: str
    reference_audio: str | None = None
    reference_text: str | None = None
    authorization_status: str


class CreateVoiceRequest(BaseModel):
    name: str = Field(min_length=1)
    reference_audio: str | None = None
    reference_text: str | None = None
    authorization_status: str


class BatchProjectStatus(StrEnum):
    draft = "draft"
    queued = "queued"
    running = "running"
    completed = "completed"
    failed = "failed"


class BatchSegmentStatus(StrEnum):
    pending = "pending"
    running = "running"
    succeeded = "succeeded"
    failed = "failed"


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


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


class BatchProjectUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=120)
    model: str | None = Field(default=None, min_length=1)
    segments: list[BatchSegmentDraft] | None = Field(default=None, min_length=1, max_length=500)
    reference_audio: str | None = None
    reference_text: str | None = None
    emotion: str | None = None
    speed: float | None = Field(default=None, ge=0.25, le=4.0)


class BatchProject(BaseModel):
    id: str
    title: str
    model: str
    segments: list[BatchSegment]
    reference_audio: str | None = None
    reference_text: str | None = None
    emotion: str | None = None
    speed: float = 1.0
    status: BatchProjectStatus = BatchProjectStatus.draft
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)
    started_at: datetime | None = None
    completed_at: datetime | None = None

    @property
    def progress(self) -> tuple[int, int]:
        finished = sum(segment.status == BatchSegmentStatus.succeeded for segment in self.segments)
        return finished, len(self.segments)
