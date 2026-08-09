from datetime import datetime, timezone
from enum import StrEnum

from pydantic import BaseModel, Field, field_validator, model_validator


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


class AlignmentGranularity(StrEnum):
    segment = "segment"
    token = "token"
    word = "word"


class AlignmentRequest(BaseModel):
    """Optional post-synthesis alignment request.

    The text is deliberately the TTS input, rather than a caller supplied
    alternate transcript.  This prevents an alignment request from becoming a
    second source of truth for the generated narration.
    """

    enabled: bool = False
    granularity: AlignmentGranularity = AlignmentGranularity.segment
    language: str = Field(default="zh", min_length=2, max_length=16)
    wait_for_result: bool = False


class AlignmentStatus(StrEnum):
    pending = "pending"
    completed = "completed"
    failed = "failed"
    cancelled = "cancelled"


class AlignmentJobStatus(StrEnum):
    queued = "queued"
    running = "running"
    completed = "completed"
    failed = "failed"
    cancelled = "cancelled"


class AlignmentSegment(BaseModel):
    id: str
    text: str
    char_start: int = Field(ge=0)
    char_end: int = Field(ge=0)
    start_seconds: float = Field(ge=0)
    end_seconds: float = Field(ge=0)
    # Qwen3-ForcedAligner exposes real boundaries but not calibrated token
    # probabilities.  Null is more truthful than inventing a confidence.
    confidence: float | None = Field(default=None, ge=0, le=1)


class AlignmentToken(BaseModel):
    text: str
    char_start: int = Field(ge=0)
    char_end: int = Field(ge=0)
    start_seconds: float = Field(ge=0)
    end_seconds: float = Field(ge=0)
    confidence: float | None = Field(default=None, ge=0, le=1)


class AlignmentResult(BaseModel):
    version: int = 1
    language: str
    audio_sha256: str
    transcript_sha256: str
    model_version: str
    duration_seconds: float = Field(ge=0)
    segments: list[AlignmentSegment] = Field(default_factory=list)
    tokens: list[AlignmentToken] = Field(default_factory=list)
    # "words" is included when requested.  Chinese consumers must use tokens
    # for character animation because semantic word segmentation is not a
    # reliable timing primitive.
    words: list[AlignmentToken] | None = None
    warnings: list[str] = Field(default_factory=list)


class AlignmentJobInfo(BaseModel):
    """Public, safe-to-persist status of one post-synthesis alignment task.

    It intentionally contains hashes and output identifiers only.  In
    particular it never records a voice reference path, reference transcript,
    API key, or the temporary worker request file.
    """

    id: str
    status: AlignmentJobStatus
    speech_job_id: str | None = None
    audio_url: str
    duration_seconds: float = Field(ge=0)
    language: str
    granularity: AlignmentGranularity
    audio_sha256: str
    transcript_sha256: str
    model_version: str
    cache_key: str
    alignment_url: str
    alignment: AlignmentResult | None = None
    error: str | None = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    started_at: datetime | None = None
    completed_at: datetime | None = None
    retry_of: str | None = None


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
    pitch: int = Field(default=0, ge=-12, le=12)
    cfg: float | None = Field(default=None, ge=1.0, le=3.0)
    inference_steps: int | None = Field(default=None, ge=1, le=50)
    temperature: float | None = Field(default=None, ge=0.1, le=2.0)
    top_p: float | None = Field(default=None, ge=0.0, le=1.0)
    top_k: int | None = Field(default=None, ge=0, le=100)
    num_beams: int | None = Field(default=None, ge=1, le=10)
    repetition_penalty: float | None = Field(default=None, ge=0.1, le=20.0)
    max_mel_tokens: int | None = Field(default=None, ge=50, le=1815)
    normalize: bool | None = None
    denoise: bool | None = None
    stream: bool = False
    alignment: AlignmentRequest | None = None


class SpeechResult(BaseModel):
    audio_url: str
    file_path: str
    model: str
    sample_rate: int
    duration_seconds: float
    alignment_status: AlignmentStatus | None = None
    alignment_url: str | None = None
    alignment: AlignmentResult | None = None


class TranscriptionResult(BaseModel):
    """Text returned by the selected local ASR runtime."""

    text: str
    language: str
    model: str


class TranscriptionBackend(StrEnum):
    sensevoice = "sensevoice"
    qwen3 = "qwen3"


class TranscriptionOutputFormat(StrEnum):
    txt = "txt"
    srt = "srt"


class TranscriptionJobStatus(StrEnum):
    queued = "queued"
    running = "running"
    completed = "completed"
    failed = "failed"
    cancelled = "cancelled"


class TranscriptionInputInfo(BaseModel):
    """A managed local media import.  The source path is intentionally absent."""

    id: str = Field(min_length=8, max_length=128)
    file_name: str = Field(min_length=1, max_length=255)
    file_size_bytes: int = Field(ge=0)


class TranscriptionJobRequest(BaseModel):
    input_id: str = Field(min_length=8, max_length=128)
    source_file_name: str = Field(min_length=1, max_length=255)
    backend: TranscriptionBackend = TranscriptionBackend.sensevoice
    output_format: TranscriptionOutputFormat = TranscriptionOutputFormat.txt
    language: str = Field(default="zh", min_length=2, max_length=16)


class TranscriptionToken(BaseModel):
    text: str = Field(min_length=1)
    start_seconds: float = Field(ge=0)
    end_seconds: float = Field(ge=0)


class TranscriptionSegment(BaseModel):
    id: str
    text: str = Field(min_length=1)
    start_seconds: float = Field(ge=0)
    end_seconds: float = Field(ge=0)


class TranscriptionJobInfo(BaseModel):
    """Safe persisted state for an imported audio/video transcription task.

    Source paths, temporary worker paths and any voice-reference data are
    deliberately excluded.  `input_id` is only an opaque managed-file key.
    """

    id: str
    status: TranscriptionJobStatus
    input_id: str
    source_file_name: str
    source_file_size_bytes: int = Field(ge=0)
    backend: TranscriptionBackend
    output_format: TranscriptionOutputFormat
    language: str
    stage: str = "queued"
    progress_percent: int = Field(default=0, ge=0, le=100)
    model: str | None = None
    duration_seconds: float | None = Field(default=None, ge=0)
    text: str | None = None
    tokens: list[TranscriptionToken] = Field(default_factory=list)
    segments: list[TranscriptionSegment] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    error: str | None = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    started_at: datetime | None = None
    completed_at: datetime | None = None
    retry_of: str | None = None


class AudioEnhancementBackend(StrEnum):
    deepfilternet3 = "deepfilternet3"
    mossformer2_se_48k = "mossformer2-se-48k"


class AudioEnhancementPreset(StrEnum):
    light = "light"
    standard = "standard"
    strong = "strong"


class AudioEnhancementJobStatus(StrEnum):
    queued = "queued"
    running = "running"
    completed = "completed"
    failed = "failed"
    cancelled = "cancelled"


class AudioEnhancementInputInfo(BaseModel):
    """A managed local import used only by audio-enhancement jobs."""

    id: str = Field(min_length=8, max_length=128)
    file_name: str = Field(min_length=1, max_length=255)
    file_size_bytes: int = Field(ge=0)


class AudioEnhancementJobRequest(BaseModel):
    input_id: str = Field(min_length=8, max_length=128)
    source_file_name: str = Field(min_length=1, max_length=255)
    backends: list[AudioEnhancementBackend] = Field(min_length=1, max_length=2)
    preset: AudioEnhancementPreset = AudioEnhancementPreset.standard

    @field_validator("backends")
    @classmethod
    def no_duplicate_backends(cls, value: list[AudioEnhancementBackend]) -> list[AudioEnhancementBackend]:
        if len(set(value)) != len(value):
            raise ValueError("每个语音增强模型只能选择一次。")
        return value


class AudioEnhancementOutput(BaseModel):
    backend: AudioEnhancementBackend
    model: str
    audio_url: str
    file_path: str
    sample_rate: int = Field(ge=1)
    duration_seconds: float = Field(ge=0)


class AudioEnhancementJobInfo(BaseModel):
    """Safe, persistent state for a local speech-enhancement comparison job."""

    id: str
    status: AudioEnhancementJobStatus
    input_id: str
    source_file_name: str
    source_file_size_bytes: int = Field(ge=0)
    backends: list[AudioEnhancementBackend]
    preset: AudioEnhancementPreset
    stage: str = "queued"
    progress_percent: int = Field(default=0, ge=0, le=100)
    outputs: list[AudioEnhancementOutput] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    error: str | None = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    started_at: datetime | None = None
    completed_at: datetime | None = None
    retry_of: str | None = None


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
    # ``source`` keeps cloud realtime turns distinguishable from ordinary
    # single-sentence synthesis while retaining the same durable job store.
    source: str = "speech"
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


class TaskResult(BaseModel):
    """A concrete or exportable result produced by a managed task.

    ``file_path`` is present only for files already written under the managed
    output directory.  Text and subtitle exports remain virtual until the user
    explicitly exports them, but still appear in the same result collection.
    """

    id: str
    kind: str
    label: str
    file_name: str
    file_path: str | None = None
    url: str | None = None
    mime_type: str | None = None
    size_bytes: int | None = Field(default=None, ge=0)
    duration_seconds: float | None = Field(default=None, ge=0)
    model: str | None = None
    text: str | None = None
    exists: bool = True
    downloadable: bool = False


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
    results: list[TaskResult] = Field(default_factory=list)


class AudioAsset(BaseModel):
    asset_id: str
    file_name: str
    file_path: str
    audio_url: str
    file_size_bytes: int = Field(ge=0)
    modified_at: datetime
    source: str = "untracked"
    # ``origin`` answers where the audio was produced, while ``source`` keeps
    # the useful task granularity (single sentence / batch / directory file).
    origin: str = "monitored"
    model: str | None = None
    text: str | None = None
    duration_seconds: float | None = Field(default=None, ge=0)
    task_id: str | None = None
    project_id: str | None = None
    project_title: str | None = None


class ModelVoiceBinding(BaseModel):
    """A voice entry backed by weights that only one model can load."""

    model_id: str = Field(min_length=1, max_length=80)
    weights: dict[str, str] = Field(default_factory=dict)


class VoiceReference(BaseModel):
    """One independently editable reference clip belonging to a voice role."""

    id: str
    name: str = Field(min_length=1, max_length=120)
    reference_audio: str | None = None
    reference_text: str | None = None
    source_type: str = "local_import"
    source_url: str | None = None
    original_reference_audio: str | None = None
    reference_audio_sha256: str | None = None
    reference_audio_managed: bool = False
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)


class VoiceInfo(BaseModel):
    id: str
    name: str
    reference_audio: str | None = None
    reference_text: str | None = None
    authorization_status: str
    source_type: str = "local_import"
    source_url: str | None = None
    original_reference_audio: str | None = None
    reference_audio_sha256: str | None = None
    reference_audio_managed: bool = False
    references: list[VoiceReference] = Field(default_factory=list)
    active_reference_id: str | None = None
    model_binding: ModelVoiceBinding | None = None
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)

    @model_validator(mode="after")
    def normalize_references(self) -> "VoiceInfo":
        """Keep old clients working while persisting roles as reference clips.

        Before role support, a voice stored exactly one reference on the root
        object. Old libraries are promoted lazily into a stable main clip; the
        root fields remain a compatibility projection of the active clip for
        existing generation, batch-project and third-party API callers.
        """
        if not self.references and self.reference_audio:
            self.references = [
                VoiceReference(
                    id="legacy-main",
                    name="主参考",
                    reference_audio=self.reference_audio,
                    reference_text=self.reference_text,
                    source_type=self.source_type,
                    source_url=self.source_url,
                    original_reference_audio=self.original_reference_audio,
                    reference_audio_sha256=self.reference_audio_sha256,
                    reference_audio_managed=self.reference_audio_managed,
                    created_at=self.created_at,
                    updated_at=self.updated_at,
                )
            ]
            self.active_reference_id = "legacy-main"

        if not self.references:
            self.active_reference_id = None
            return self

        active = next((item for item in self.references if item.id == self.active_reference_id), None)
        if active is None:
            active = self.references[0]
            self.active_reference_id = active.id

        self.reference_audio = active.reference_audio
        self.reference_text = active.reference_text
        self.original_reference_audio = active.original_reference_audio
        self.reference_audio_sha256 = active.reference_audio_sha256
        self.reference_audio_managed = active.reference_audio_managed
        return self


class CreateVoiceRequest(BaseModel):
    name: str = Field(min_length=1)
    reference_audio: str | None = None
    trim_start_seconds: float | None = Field(default=None, ge=0)
    trim_end_seconds: float | None = Field(default=None, gt=0)
    reference_text: str | None = None
    reference_name: str | None = Field(default=None, max_length=120)
    authorization_status: str
    source_type: str = Field(default="local_import", max_length=80)
    source_url: str | None = Field(default=None, max_length=2000)
    model_binding: ModelVoiceBinding | None = None


class UpdateVoiceRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1)
    reference_audio: str | None = Field(default=None, min_length=1)
    trim_start_seconds: float | None = Field(default=None, ge=0)
    trim_end_seconds: float | None = Field(default=None, gt=0)
    reference_text: str | None = None
    authorization_status: str | None = None
    source_type: str | None = Field(default=None, max_length=80)
    source_url: str | None = Field(default=None, max_length=2000)


class CreateVoiceReferenceRequest(BaseModel):
    name: str = Field(default="参考片段", min_length=1, max_length=120)
    reference_audio: str = Field(min_length=1)
    trim_start_seconds: float | None = Field(default=None, ge=0)
    trim_end_seconds: float | None = Field(default=None, gt=0)
    reference_text: str | None = None
    source_type: str = Field(default="local_import", max_length=80)
    source_url: str | None = Field(default=None, max_length=2000)


class UpdateVoiceReferenceRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    reference_audio: str | None = Field(default=None, min_length=1)
    trim_start_seconds: float | None = Field(default=None, ge=0)
    trim_end_seconds: float | None = Field(default=None, gt=0)
    reference_text: str | None = None
    source_type: str | None = Field(default=None, max_length=80)
    source_url: str | None = Field(default=None, max_length=2000)


class VoicePackageExport(BaseModel):
    file_name: str
    export_path: str


class VoicePackageImportRequest(BaseModel):
    package_path: str = Field(min_length=1)


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


class VoiceAudioRepair(BaseModel):
    """Result of normalizing a managed reference audio file for broad TTS compatibility."""

    voice: VoiceInfo
    converted: bool


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
    voice: str | None = None
    pitch: int = Field(default=0, ge=-12, le=12)
    response_format: str = "wav"
    speed: float = Field(default=1.0, ge=0.25, le=4.0)
    cfg: float | None = Field(default=None, ge=1.0, le=3.0)
    inference_steps: int | None = Field(default=None, ge=1, le=50)
    temperature: float | None = Field(default=None, ge=0.1, le=2.0)
    top_p: float | None = Field(default=None, ge=0.0, le=1.0)
    top_k: int | None = Field(default=None, ge=0, le=100)
    num_beams: int | None = Field(default=None, ge=1, le=10)
    repetition_penalty: float | None = Field(default=None, ge=0.1, le=20.0)
    max_mel_tokens: int | None = Field(default=None, ge=50, le=1815)
    normalize: bool | None = None
    denoise: bool | None = None


class BatchProjectUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=120)
    model: str | None = Field(default=None, min_length=1)
    segments: list[BatchSegmentDraft] | None = Field(default=None, min_length=1, max_length=500)
    reference_audio: str | None = None
    reference_text: str | None = None
    emotion: str | None = None
    voice: str | None = None
    pitch: int | None = Field(default=None, ge=-12, le=12)
    response_format: str | None = None
    speed: float | None = Field(default=None, ge=0.25, le=4.0)
    cfg: float | None = Field(default=None, ge=1.0, le=3.0)
    inference_steps: int | None = Field(default=None, ge=1, le=50)
    temperature: float | None = Field(default=None, ge=0.1, le=2.0)
    top_p: float | None = Field(default=None, ge=0.0, le=1.0)
    top_k: int | None = Field(default=None, ge=0, le=100)
    num_beams: int | None = Field(default=None, ge=1, le=10)
    repetition_penalty: float | None = Field(default=None, ge=0.1, le=20.0)
    max_mel_tokens: int | None = Field(default=None, ge=50, le=1815)
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
    voice: str | None = None
    pitch: int = 0
    response_format: str = "wav"
    speed: float = 1.0
    cfg: float | None = None
    inference_steps: int | None = None
    temperature: float | None = None
    top_p: float | None = None
    top_k: int | None = None
    num_beams: int | None = None
    repetition_penalty: float | None = None
    max_mel_tokens: int | None = None
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
