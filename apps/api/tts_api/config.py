from functools import lru_cache
import json
import os
import sys
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, Field


WORKSPACE_ROOT = Path(__file__).resolve().parents[3]
# Desktop builds keep executable resources read-only. Every mutable model asset
# (weights, isolated Python runtimes and CUDA overlays) belongs to the
# user-managed model store instead. Development keeps the historical
# workspace/models default unless the desktop launcher provides this value.
MODEL_STORE_ROOT = Path(os.environ.get("OPEN_TTS_MODEL_STORE_ROOT") or (WORKSPACE_ROOT / "models"))
MANAGED_STORAGE_ROOT = Path(os.environ["OPEN_TTS_STORAGE_ROOT"]) if os.environ.get("OPEN_TTS_STORAGE_ROOT") else None
DEFAULT_INDEXTTS2_ROOT = MODEL_STORE_ROOT / "IndexTTS2"
DEFAULT_VOXCPM2_ROOT = MODEL_STORE_ROOT / "VoxCPM2"
DEFAULT_GPTSOVITS_ROOT = MODEL_STORE_ROOT / "GPT-SoVITS"
DEFAULT_SENSEVOICE_ROOT = MODEL_STORE_ROOT / "SenseVoiceSmall"
DEFAULT_QWEN_ASR_ROOT = MODEL_STORE_ROOT / "Qwen3-ASR-1.7B"
DEFAULT_QWEN_ALIGNER_ROOT = MODEL_STORE_ROOT / "Qwen3-ForcedAligner-0.6B"
DEFAULT_CAPSWRITER_ROOT = MODEL_STORE_ROOT / "CapsWriter-Offline"
DEFAULT_QWEN_RUNTIME_ROOT = MODEL_STORE_ROOT / "Qwen3-runtime"
DEFAULT_QWEN_CUDA_RUNTIME_ROOT = MODEL_STORE_ROOT / "Qwen3-runtime-cuda"
DEFAULT_QWEN_CUDA_BACKEND_DIR = DEFAULT_CAPSWRITER_ROOT / ".open-tts-backends" / "cuda"
DEFAULT_DEEPFILTERNET3_ROOT = MODEL_STORE_ROOT / "DeepFilterNet3"
DEFAULT_MOSSFORMER2_SE_ROOT = MODEL_STORE_ROOT / "MossFormer2-SE-48K"
DEFAULT_AUDIO_SEPARATION_ROOT = MODEL_STORE_ROOT / "MDX_Net_Models"
DEFAULT_SETTINGS_FILE = WORKSPACE_ROOT / "data" / "config" / "user-settings.json"


def _default_storage_root() -> Path:
    return MANAGED_STORAGE_ROOT or MODEL_STORE_ROOT.parent


def _default_output_dir() -> Path:
    if MANAGED_STORAGE_ROOT:
        return MANAGED_STORAGE_ROOT / "data" / "outputs"
    configured = os.environ.get("OPEN_TTS_OUTPUT_DIR")
    if configured:
        return Path(configured)
    return WORKSPACE_ROOT / "data" / "outputs"


def _apply_managed_storage_layout(values: dict) -> dict:
    """Keep launcher-owned data paths from drifting due to old saved settings."""

    if MANAGED_STORAGE_ROOT is None:
        return values
    normalized = dict(values)
    normalized["storage_root"] = str(MANAGED_STORAGE_ROOT)
    normalized["output_dir"] = str(MANAGED_STORAGE_ROOT / "data" / "outputs")
    return normalized


def get_app_version() -> str:
    """Return the desktop release version without coupling the API to Electron."""
    explicit_version = os.environ.get("OPEN_TTS_APP_VERSION", "").strip()
    if explicit_version:
        return explicit_version.removeprefix("v")

    package_file = WORKSPACE_ROOT / "apps" / "desktop" / "package.json"
    try:
        package = json.loads(package_file.read_text(encoding="utf-8"))
        version = str(package.get("version", "")).strip()
        if version:
            return version.removeprefix("v")
    except (OSError, json.JSONDecodeError, AttributeError):
        pass
    return "0.1.0"


def _default_tasks_file() -> Path:
    explicit_path = os.environ.get("OPEN_TTS_TASKS_FILE")
    if explicit_path:
        return Path(explicit_path)
    configured_settings = os.environ.get("OPEN_TTS_SETTINGS_FILE")
    if configured_settings:
        return Path(configured_settings).parent / "tasks.json"
    return WORKSPACE_ROOT / "data" / "config" / "tasks.json"


def _default_task_log_dir() -> Path:
    explicit_path = os.environ.get("OPEN_TTS_TASK_LOG_DIR")
    if explicit_path:
        return Path(explicit_path)
    configured_settings = os.environ.get("OPEN_TTS_SETTINGS_FILE")
    if configured_settings:
        return Path(configured_settings).parent / "task-logs"
    return WORKSPACE_ROOT / "data" / "logs" / "tasks"


def _default_alignment_jobs_file() -> Path:
    explicit_path = os.environ.get("OPEN_TTS_ALIGNMENT_JOBS_FILE")
    if explicit_path:
        return Path(explicit_path)
    configured_tasks = os.environ.get("OPEN_TTS_TASKS_FILE")
    if configured_tasks:
        return Path(configured_tasks).with_name("alignments.json")
    return WORKSPACE_ROOT / "data" / "config" / "alignments.json"


def _default_alignment_cache_dir() -> Path:
    explicit_path = os.environ.get("OPEN_TTS_ALIGNMENT_CACHE_DIR")
    if explicit_path:
        return Path(explicit_path)
    return WORKSPACE_ROOT / "data" / "alignments" / "cache"


def _default_alignment_work_dir() -> Path:
    explicit_path = os.environ.get("OPEN_TTS_ALIGNMENT_WORK_DIR")
    if explicit_path:
        return Path(explicit_path)
    return WORKSPACE_ROOT / "data" / "alignments" / "work"


def _default_qwen_asr_work_dir() -> Path:
    explicit_path = os.environ.get("OPEN_TTS_QWEN_ASR_WORK_DIR")
    if explicit_path:
        return Path(explicit_path)
    return WORKSPACE_ROOT / "data" / "asr" / "qwen3-work"


def _default_transcription_jobs_file() -> Path:
    explicit_path = os.environ.get("OPEN_TTS_TRANSCRIPTION_JOBS_FILE")
    if explicit_path:
        return Path(explicit_path)
    configured_settings = os.environ.get("OPEN_TTS_SETTINGS_FILE")
    if configured_settings:
        return Path(configured_settings).parent / "transcriptions.json"
    return WORKSPACE_ROOT / "data" / "config" / "transcriptions.json"


def _default_transcription_input_dir() -> Path:
    explicit_path = os.environ.get("OPEN_TTS_TRANSCRIPTION_INPUT_DIR")
    if explicit_path:
        return Path(explicit_path)
    return WORKSPACE_ROOT / "data" / "transcriptions" / "inputs"


def _default_audio_enhancement_jobs_file() -> Path:
    explicit_path = os.environ.get("OPEN_TTS_AUDIO_ENHANCEMENT_JOBS_FILE")
    if explicit_path:
        return Path(explicit_path)
    configured_settings = os.environ.get("OPEN_TTS_SETTINGS_FILE")
    if configured_settings:
        return Path(configured_settings).parent / "audio-enhancements.json"
    return WORKSPACE_ROOT / "data" / "config" / "audio-enhancements.json"


def _default_audio_enhancement_input_dir() -> Path:
    explicit_path = os.environ.get("OPEN_TTS_AUDIO_ENHANCEMENT_INPUT_DIR")
    if explicit_path:
        return Path(explicit_path)
    return WORKSPACE_ROOT / "data" / "audio-enhancements" / "inputs"


def _default_audio_enhancement_work_dir() -> Path:
    explicit_path = os.environ.get("OPEN_TTS_AUDIO_ENHANCEMENT_WORK_DIR")
    if explicit_path:
        return Path(explicit_path)
    return WORKSPACE_ROOT / "data" / "audio-enhancements" / "work"


def _default_audio_enhancement_python() -> Path:
    configured = os.environ.get("OPEN_TTS_AUDIO_ENHANCEMENT_PYTHON")
    if configured:
        return Path(configured)
    executable = "python.exe" if os.name == "nt" else "python"
    # Enhancement has an intentionally isolated dependency set.  Do not fall
    # back to the lightweight desktop API interpreter: it would be reported as
    # installed although it cannot run ClearVoice/MossFormer.  Both optional
    # enhancement runtimes live beside the rest of the managed model assets.
    for name in ("audio-enhancement-runtime-full", "audio-enhancement-runtime"):
        candidate = MODEL_STORE_ROOT / name / "Scripts" / executable
        if candidate.is_file():
            return candidate
    return MODEL_STORE_ROOT / "audio-enhancement-runtime" / "Scripts" / executable


def _default_audio_separation_python() -> Path:
    configured = os.environ.get("OPEN_TTS_AUDIO_SEPARATION_PYTHON")
    if configured:
        return Path(configured)
    executable = "python.exe" if os.name == "nt" else "python"
    for name in ("audio-separation-runtime-full", "audio-separation-runtime"):
        candidate = MODEL_STORE_ROOT / name / "Scripts" / executable
        if candidate.is_file():
            return candidate
    return MODEL_STORE_ROOT / "audio-separation-runtime" / "Scripts" / executable


def _default_audio_separation_root() -> Path:
    # ``OPEN_TTS_AUDIO_SEPARATION_ROOT`` was already the job-workspace
    # override (inputs, work files and job state) before model-root settings
    # were introduced.  Keep that meaning: using it for model discovery would
    # otherwise make a configured MDX model directory receive temporary media
    # and jobs.json.  New deployments can use the explicit model-root name;
    # OPEN_TTS_MDX_MODEL_ROOT remains the compatible UVR-oriented alias.
    configured = os.environ.get("OPEN_TTS_AUDIO_SEPARATION_MODEL_ROOT") or os.environ.get("OPEN_TTS_MDX_MODEL_ROOT")
    return Path(configured) if configured else DEFAULT_AUDIO_SEPARATION_ROOT


def _default_qwen_asr_python() -> Path:
    configured = os.environ.get("OPEN_TTS_QWEN_ASR_PYTHON")
    if configured:
        return Path(configured)
    bundled = DEFAULT_QWEN_RUNTIME_ROOT / "python.exe"
    if bundled.is_file():
        return bundled
    return Path(os.environ.get("OPEN_TTS_ALIGNMENT_PYTHON", sys.executable))


def _default_qwen_cuda_python() -> Path:
    configured = os.environ.get("OPEN_TTS_QWEN_CUDA_PYTHON")
    if configured:
        return Path(configured)
    return DEFAULT_QWEN_CUDA_RUNTIME_ROOT / "python.exe"


def _default_qwen_cuda_backend_dir() -> Path:
    configured = os.environ.get("OPEN_TTS_QWEN_CUDA_BACKEND_DIR")
    return Path(configured) if configured else DEFAULT_QWEN_CUDA_BACKEND_DIR


def _default_qwen_asr_capswriter_root() -> Path | None:
    configured = os.environ.get("OPEN_TTS_QWEN_ASR_CAPSWRITER_ROOT") or os.environ.get("OPEN_TTS_ALIGNMENT_CAPSWRITER_ROOT")
    if configured:
        return Path(configured)
    return DEFAULT_CAPSWRITER_ROOT if DEFAULT_CAPSWRITER_ROOT.is_dir() else None


def _default_qwen_asr_model_dir() -> Path:
    # The former alignment-only variable remains a migration fallback for
    # existing local Qwen installs. New deployments should use the dedicated
    # OPEN_TTS_QWEN_ASR_MODEL_DIR setting.
    configured = os.environ.get("OPEN_TTS_QWEN_ASR_MODEL_DIR") or os.environ.get("OPEN_TTS_ALIGNMENT_ASR_MODEL_DIR")
    return Path(configured) if configured else DEFAULT_QWEN_ASR_ROOT


def _default_alignment_python() -> Path:
    configured = os.environ.get("OPEN_TTS_ALIGNMENT_PYTHON")
    if configured:
        return Path(configured)
    bundled = DEFAULT_QWEN_RUNTIME_ROOT / "python.exe"
    return bundled if bundled.is_file() else Path(sys.executable)


def _default_alignment_capswriter_root() -> Path | None:
    configured = os.environ.get("OPEN_TTS_ALIGNMENT_CAPSWRITER_ROOT")
    if configured:
        return Path(configured)
    return DEFAULT_CAPSWRITER_ROOT if DEFAULT_CAPSWRITER_ROOT.is_dir() else None


def _default_alignment_aligner_model_dir() -> Path | None:
    configured = os.environ.get("OPEN_TTS_ALIGNMENT_ALIGNER_MODEL_DIR")
    if configured:
        return Path(configured)
    return DEFAULT_QWEN_ALIGNER_ROOT if DEFAULT_QWEN_ALIGNER_ROOT.is_dir() else None


def _default_sensevoice_model_dir() -> Path:
    """Resolve the standalone SenseVoice model asset only.

    OpenTTS deliberately never discovers ASR weights inside a TTS package.
    Install the asset in ``models/SenseVoiceSmall`` or set
    ``OPEN_TTS_SENSEVOICE_MODEL_DIR`` explicitly.
    """

    configured = os.environ.get("OPEN_TTS_SENSEVOICE_MODEL_DIR")
    if configured:
        return Path(configured)
    return DEFAULT_SENSEVOICE_ROOT


def _default_sensevoice_python() -> Path:
    """Resolve the configured local ASR runtime without starting any TTS service."""

    configured = os.environ.get("OPEN_TTS_SENSEVOICE_PYTHON")
    if configured:
        return Path(configured)
    standalone = DEFAULT_SENSEVOICE_ROOT / "runtime" / "python.exe"
    return standalone


def _default_voice_asset_dir() -> Path:
    explicit_path = os.environ.get("OPEN_TTS_VOICE_ASSET_DIR")
    if explicit_path:
        return Path(explicit_path)
    configured_library = os.environ.get("OPEN_TTS_VOICE_LIBRARY_FILE")
    if configured_library:
        return Path(configured_library).parent / "voice-assets"
    return WORKSPACE_ROOT / "data" / "voices"


def _default_voice_export_dir() -> Path:
    explicit_path = os.environ.get("OPEN_TTS_VOICE_EXPORT_DIR")
    if explicit_path:
        return Path(explicit_path)
    configured_library = os.environ.get("OPEN_TTS_VOICE_LIBRARY_FILE")
    if configured_library:
        return Path(configured_library).parent / "voice-exports"
    return WORKSPACE_ROOT / "data" / "exports" / "voices"


def _default_doubao_cookie_file() -> Path:
    explicit_path = os.environ.get("OPEN_TTS_DOUBAO_COOKIE_FILE")
    if explicit_path:
        return Path(explicit_path)
    configured_settings = os.environ.get("OPEN_TTS_SETTINGS_FILE")
    if configured_settings:
        return Path(configured_settings).parent / "doubao-cookies.json"
    return WORKSPACE_ROOT / "data" / "config" / "doubao-cookies.json"


def _default_doubao_data_dir() -> Path:
    explicit_path = os.environ.get("OPEN_TTS_DOUBAO_DATA_DIR")
    if explicit_path:
        return Path(explicit_path)
    configured_settings = os.environ.get("OPEN_TTS_SETTINGS_FILE")
    if configured_settings:
        return Path(configured_settings).parent / "doubao-data"
    return WORKSPACE_ROOT / "data" / "doubao"


USER_SETTING_KEYS = {
    "storage_root",
    "api_host",
    "api_port",
    "output_dir",
    "indextts2_root",
    "indextts2_idle_timeout_seconds",
    "local_api_idle_timeout_seconds",
    "voxcpm2_root",
    "voxcpm2_api_host",
    "voxcpm2_api_port",
    "voxcpm2_streaming_api_host",
    "voxcpm2_streaming_api_port",
    "gptsovits_root",
    "gptsovits_api_host",
    "gptsovits_api_port",
    "default_model_id",
    "prewarm_default_model_on_startup",
    "doubao_timeout_seconds",
    "doubao_retry_count",
    "doubao_request_interval_delay_seconds",
    "legado_timeout_seconds",
    "book_cache_concurrency",
    "doubao_data_dir",
    "ffmpeg_path",
    "asr_backend",
    "qwen_asr_python",
    "qwen_asr_capswriter_root",
    "qwen_asr_model_dir",
    "qwen_asr_device",
    "alignment_device",
    "alignment_python",
    "alignment_capswriter_root",
    "alignment_aligner_model_dir",
    "sensevoice_python",
    "sensevoice_model_dir",
    "sensevoice_api_host",
    "sensevoice_api_port",
    "sensevoice_device",
    "sensevoice_idle_timeout_seconds",
    "audio_enhancement_python",
    "audio_enhancement_device",
    "deepfilternet3_root",
    "mossformer2_se_root",
    "audio_separation_python",
    "audio_separation_root",
    "audio_separation_device",
    "model_instances",
}
RESTART_REQUIRED_FIELDS = ["api_host", "api_port"]


class Settings(BaseModel):
    app_name: str = "Open TTS Desktop API"
    api_host: str = Field(default_factory=lambda: os.environ.get("OPEN_TTS_API_HOST", "127.0.0.1"))
    api_port: int = Field(default_factory=lambda: int(os.environ.get("OPEN_TTS_API_PORT", "8765")))
    backend_token: str | None = Field(default_factory=lambda: os.environ.get("OPEN_TTS_BACKEND_TOKEN") or None)
    api_access_key: str | None = Field(default_factory=lambda: os.environ.get("OPEN_TTS_API_KEY") or None)
    workspace_root: Path = WORKSPACE_ROOT
    storage_root: Path = Field(default_factory=_default_storage_root)
    output_dir: Path = Field(default_factory=_default_output_dir)
    model_registry_path: Path = WORKSPACE_ROOT / "model-registry" / "models.json"
    settings_file: Path = Field(default_factory=lambda: Path(os.environ.get("OPEN_TTS_SETTINGS_FILE", str(DEFAULT_SETTINGS_FILE))))
    voice_library_file: Path = Field(default_factory=lambda: Path(os.environ.get("OPEN_TTS_VOICE_LIBRARY_FILE", str(WORKSPACE_ROOT / "data" / "config" / "voices.json"))))
    voice_asset_dir: Path = Field(default_factory=_default_voice_asset_dir)
    voice_export_dir: Path = Field(default_factory=_default_voice_export_dir)
    projects_file: Path = Field(default_factory=lambda: Path(os.environ.get("OPEN_TTS_PROJECTS_FILE", str(WORKSPACE_ROOT / "data" / "config" / "projects.json"))))
    model_packages_file: Path = Field(default_factory=lambda: Path(os.environ.get("OPEN_TTS_MODEL_PACKAGES_FILE", str(WORKSPACE_ROOT / "data" / "config" / "model-packages.json"))))
    tasks_file: Path = Field(default_factory=_default_tasks_file)
    task_log_dir: Path = Field(default_factory=_default_task_log_dir)
    alignment_jobs_file: Path = Field(default_factory=_default_alignment_jobs_file)
    alignment_cache_dir: Path = Field(default_factory=_default_alignment_cache_dir)
    alignment_work_dir: Path = Field(default_factory=_default_alignment_work_dir)
    # Qwen3-ForcedAligner is run in a separately configured,
    # local CapsWriter runtime.  Keeping it isolated avoids a second native
    # ONNX/llama stack inside the lightweight FastAPI desktop runtime.
    alignment_python: Path = Field(default_factory=_default_alignment_python)
    alignment_capswriter_root: Path | None = Field(default_factory=_default_alignment_capswriter_root)
    alignment_aligner_model_dir: Path | None = Field(default_factory=_default_alignment_aligner_model_dir)
    alignment_device: Literal["auto", "cuda", "dml", "cpu"] = Field(
        default_factory=lambda: os.environ.get("OPEN_TTS_ALIGNMENT_DEVICE", "auto")
    )
    alignment_model_version: str = "qwen3-forced-aligner-0.6b"
    alignment_worker_timeout_seconds: int = Field(
        default_factory=lambda: int(os.environ.get("OPEN_TTS_ALIGNMENT_TIMEOUT_SECONDS", "900")), ge=30, le=7200
    )
    # General local transcription backend. It is intentionally independent
    # from TTS synthesis and from the final-audio forced-alignment pipeline.
    asr_backend: Literal["sensevoice", "qwen3"] = Field(
        default_factory=lambda: os.environ.get("OPEN_TTS_ASR_BACKEND", "sensevoice")
    )
    qwen_asr_python: Path = Field(default_factory=_default_qwen_asr_python)
    qwen_cuda_python: Path = Field(default_factory=_default_qwen_cuda_python)
    qwen_cuda_backend_dir: Path = Field(default_factory=_default_qwen_cuda_backend_dir)
    qwen_asr_capswriter_root: Path | None = Field(default_factory=_default_qwen_asr_capswriter_root)
    qwen_asr_model_dir: Path = Field(default_factory=_default_qwen_asr_model_dir)
    qwen_asr_work_dir: Path = Field(default_factory=_default_qwen_asr_work_dir)
    qwen_asr_device: Literal["auto", "cuda", "dml", "cpu"] = Field(
        default_factory=lambda: os.environ.get("OPEN_TTS_QWEN_ASR_DEVICE", "auto")
    )
    qwen_asr_timeout_seconds: int = Field(
        default_factory=lambda: int(os.environ.get("OPEN_TTS_QWEN_ASR_TIMEOUT_SECONDS", "900")), ge=30, le=7200
    )
    # Imported audio/video stays under this controlled directory.  API task
    # requests reference the opaque input ID only, never a caller filesystem
    # path, so a desktop selection cannot become arbitrary path access.
    transcription_jobs_file: Path = Field(default_factory=_default_transcription_jobs_file)
    transcription_input_dir: Path = Field(default_factory=_default_transcription_input_dir)
    transcription_max_input_bytes: int = Field(
        default_factory=lambda: int(os.environ.get("OPEN_TTS_TRANSCRIPTION_MAX_INPUT_BYTES", str(8 * 1024 * 1024 * 1024))),
        ge=1,
    )
    # Audio enhancement is intentionally an optional local runtime.  It does
    # not bloat the core desktop Python bundle: users point this at a Python
    # environment containing PyTorch + the two selected enhancement packages.
    audio_enhancement_jobs_file: Path = Field(default_factory=_default_audio_enhancement_jobs_file)
    audio_enhancement_input_dir: Path = Field(default_factory=_default_audio_enhancement_input_dir)
    audio_enhancement_work_dir: Path = Field(default_factory=_default_audio_enhancement_work_dir)
    audio_enhancement_python: Path = Field(default_factory=_default_audio_enhancement_python)
    audio_enhancement_device: Literal["auto", "cuda", "cpu"] = Field(
        default_factory=lambda: os.environ.get("OPEN_TTS_AUDIO_ENHANCEMENT_DEVICE", "auto")
    )
    deepfilternet3_root: Path = Field(
        default_factory=lambda: Path(os.environ.get("OPEN_TTS_DEEPFILTERNET3_ROOT", str(DEFAULT_DEEPFILTERNET3_ROOT)))
    )
    mossformer2_se_root: Path = Field(
        default_factory=lambda: Path(os.environ.get("OPEN_TTS_MOSSFORMER2_SE_ROOT", str(DEFAULT_MOSSFORMER2_SE_ROOT)))
    )
    # UVR-compatible MDX/MDXC separation has its own optional runtime and
    # local model package.  Keeping them separate from enhancement prevents a
    # core desktop Python runtime from being mistaken for a usable separator.
    audio_separation_python: Path = Field(default_factory=_default_audio_separation_python)
    audio_separation_root: Path = Field(default_factory=_default_audio_separation_root)
    audio_separation_device: Literal["auto", "cuda", "cpu"] = Field(
        default_factory=lambda: os.environ.get("OPEN_TTS_AUDIO_SEPARATION_DEVICE", "auto")
    )
    indextts2_root: Path = Field(default_factory=lambda: Path(os.environ.get("OPEN_TTS_INDEXTTS2_ROOT", str(DEFAULT_INDEXTTS2_ROOT))))
    indextts2_idle_timeout_seconds: int = Field(default_factory=lambda: int(os.environ.get("OPEN_TTS_INDEXTTS2_IDLE_SECONDS", "600")))
    local_api_idle_timeout_seconds: int = Field(default_factory=lambda: int(os.environ.get("OPEN_TTS_LOCAL_API_IDLE_SECONDS", "600")))
    # SenseVoice is a standalone local ASR runtime. Its process, model asset,
    # and configuration are wholly separate from VoxCPM2.
    sensevoice_python: Path = Field(default_factory=_default_sensevoice_python)
    sensevoice_model_dir: Path = Field(default_factory=_default_sensevoice_model_dir)
    sensevoice_api_host: str = Field(default_factory=lambda: os.environ.get("OPEN_TTS_SENSEVOICE_API_HOST", "127.0.0.1"))
    sensevoice_api_port: int = Field(default_factory=lambda: int(os.environ.get("OPEN_TTS_SENSEVOICE_API_PORT", "8004")))
    sensevoice_device: Literal["auto", "cuda", "cpu"] = Field(
        default_factory=lambda: os.environ.get("OPEN_TTS_SENSEVOICE_DEVICE", "auto")
    )
    sensevoice_idle_timeout_seconds: int = Field(
        default_factory=lambda: int(os.environ.get("OPEN_TTS_SENSEVOICE_IDLE_SECONDS", "600")), ge=0, le=86400
    )
    voxcpm2_root: Path = Field(default_factory=lambda: Path(os.environ.get("OPEN_TTS_VOXCPM2_ROOT", str(DEFAULT_VOXCPM2_ROOT))))
    voxcpm2_api_host: str = Field(default_factory=lambda: os.environ.get("OPEN_TTS_VOXCPM2_API_HOST", "127.0.0.1"))
    voxcpm2_api_port: int = Field(default_factory=lambda: int(os.environ.get("OPEN_TTS_VOXCPM2_API_PORT", "8000")))
    voxcpm2_streaming_api_host: str = Field(default_factory=lambda: os.environ.get("OPEN_TTS_VOXCPM2_STREAMING_API_HOST", "127.0.0.1"))
    voxcpm2_streaming_api_port: int = Field(default_factory=lambda: int(os.environ.get("OPEN_TTS_VOXCPM2_STREAMING_API_PORT", "8001")))
    gptsovits_root: Path = Field(default_factory=lambda: Path(os.environ.get("OPEN_TTS_GPTSOVITS_ROOT", str(DEFAULT_GPTSOVITS_ROOT))))
    gptsovits_api_host: str = Field(default_factory=lambda: os.environ.get("OPEN_TTS_GPTSOVITS_API_HOST", "127.0.0.1"))
    gptsovits_api_port: int = Field(default_factory=lambda: int(os.environ.get("OPEN_TTS_GPTSOVITS_API_PORT", "9880")))
    doubao_cookie_file: Path = Field(default_factory=_default_doubao_cookie_file)
    doubao_data_dir: Path = Field(default_factory=_default_doubao_data_dir)
    doubao_voice_catalog_path: Path = WORKSPACE_ROOT / "model-registry" / "doubao-voices.json"
    doubao_timeout_seconds: float = Field(
        default_factory=lambda: float(os.environ.get("OPEN_TTS_DOUBAO_TIMEOUT_SECONDS", "30")),
        ge=3,
        le=120,
    )
    doubao_retry_count: int = Field(
        default_factory=lambda: int(os.environ.get("OPEN_TTS_DOUBAO_RETRY_COUNT", "3")),
        ge=0,
        le=5,
    )
    doubao_request_interval_delay_seconds: float = Field(
        default_factory=lambda: float(os.environ.get("OPEN_TTS_DOUBAO_REQUEST_INTERVAL_SECONDS", "3")),
        ge=0,
        le=60,
    )
    legado_timeout_seconds: float = Field(
        default_factory=lambda: float(os.environ.get("OPEN_TTS_LEGADO_TIMEOUT_SECONDS", "10")),
        ge=1,
        le=120,
    )
    book_cache_concurrency: int = Field(
        default_factory=lambda: int(os.environ.get("OPEN_TTS_BOOK_CACHE_CONCURRENCY", "20")),
        ge=1,
        le=50,
    )
    ffmpeg_path: str = Field(default_factory=lambda: os.environ.get("OPEN_TTS_FFMPEG_PATH", "ffmpeg"))
    # Cloud providers have their own workbench and must not be selected as the
    # desktop application's local startup model.
    default_model_id: Literal["indextts2", "voxcpm2", "gptsovits"] = "indextts2"
    prewarm_default_model_on_startup: bool = False
    model_instances: dict[str, dict] = Field(default_factory=dict)


def load_user_settings(settings_file: Path) -> dict:
    if not settings_file.exists():
        return {}
    try:
        data = json.loads(settings_file.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    if not isinstance(data, dict):
        return {}
    values = {key: value for key, value in data.items() if key in USER_SETTING_KEYS and value is not None}
    # ``storage_root`` is a launcher bootstrap marker, not a free-form API
    # setting.  Source/API-only launches retain their historical workspace
    # roots unless Electron explicitly supplies a managed storage root.
    if MANAGED_STORAGE_ROOT is None:
        values.pop("storage_root", None)
    # v0.8 stored the cloud adapter as a local default model.  Keep existing
    # installations bootable while moving that preference to a real local
    # engine; cloud synthesis remains available from its separate workspace.
    if values.get("default_model_id") == "doubao-web":
        values["default_model_id"] = "indextts2"
        values["prewarm_default_model_on_startup"] = False
    return _apply_managed_storage_layout(_recover_legacy_asr_companions(values))


def _recover_legacy_asr_companions(values: dict) -> dict:
    """Recover ASR siblings when an upgraded desktop keeps external models.

    v0.8 moved mutable model files into the desktop user-data model store. A
    number of earlier installations already have a valid external model root
    recorded for a TTS or Qwen model, however.  Do not make those users enter
    several hidden ASR paths after updating: when that same root contains the
    companion assets, use it for the unset or stale ASR settings as well.
    Explicit, existing paths always remain untouched.
    """

    roots: list[Path] = []
    for key in (
        "qwen_asr_model_dir",
        "alignment_aligner_model_dir",
        "qwen_asr_capswriter_root",
        "alignment_capswriter_root",
        "sensevoice_model_dir",
        "indextts2_root",
        "voxcpm2_root",
        "gptsovits_root",
    ):
        raw_path = values.get(key)
        if not raw_path:
            continue
        try:
            root = Path(raw_path).expanduser().parent
        except TypeError:
            continue
        if root not in roots and root.is_dir():
            roots.append(root)

    legacy_root = next(
        (
            root
            for root in roots
            if any((root / name).is_dir() for name in ("Qwen3-ASR-1.7B", "CapsWriter-Offline", "SenseVoiceSmall"))
        ),
        None,
    )
    if legacy_root is None:
        return values

    recovered = dict(values)

    def use_existing(key: str, candidate: Path, *, replace_core_runtime: bool = False) -> None:
        current = recovered.get(key)
        try:
            current_exists = bool(current) and Path(current).expanduser().exists()
        except TypeError:
            current_exists = False
        current_is_core_runtime = False
        if replace_core_runtime and current:
            try:
                current_is_core_runtime = Path(current).expanduser().resolve() == Path(sys.executable).resolve()
            except OSError:
                current_is_core_runtime = False
        if candidate.exists() and (not current_exists or current_is_core_runtime):
            recovered[key] = str(candidate)

    use_existing("qwen_asr_model_dir", legacy_root / "Qwen3-ASR-1.7B")
    use_existing("qwen_asr_capswriter_root", legacy_root / "CapsWriter-Offline")
    use_existing("qwen_asr_python", legacy_root / "Qwen3-runtime" / "python.exe")
    use_existing("qwen_cuda_python", legacy_root / "Qwen3-runtime-cuda" / "python.exe")
    use_existing("qwen_cuda_backend_dir", legacy_root / "CapsWriter-Offline" / ".open-tts-backends" / "cuda")
    use_existing("alignment_capswriter_root", legacy_root / "CapsWriter-Offline")
    use_existing("alignment_aligner_model_dir", legacy_root / "Qwen3-ForcedAligner-0.6B")
    use_existing("alignment_python", legacy_root / "Qwen3-runtime" / "python.exe")
    use_existing("sensevoice_model_dir", legacy_root / "SenseVoiceSmall")
    use_existing("sensevoice_python", legacy_root / "SenseVoiceSmall" / "runtime" / "python.exe")
    # Previous desktop versions saved the lightweight bundled API Python as
    # the enhancement runtime.  That interpreter deliberately has neither
    # ClearVoice nor audio-separator, so prefer an existing sibling optional
    # runtime when the old value is exactly that core runtime.
    use_existing(
        "audio_enhancement_python",
        legacy_root / "audio-enhancement-runtime" / "Scripts" / ("python.exe" if os.name == "nt" else "python"),
        replace_core_runtime=True,
    )
    use_existing("deepfilternet3_root", legacy_root / "DeepFilterNet3")
    use_existing("mossformer2_se_root", legacy_root / "MossFormer2-SE-48K")
    use_existing(
        "audio_separation_python",
        legacy_root / "audio-separation-runtime-full" / "Scripts" / ("python.exe" if os.name == "nt" else "python"),
        replace_core_runtime=True,
    )
    use_existing("audio_separation_root", legacy_root / "MDX_Net_Models")
    return recovered


def save_user_settings(settings_file: Path, values: dict) -> None:
    existing = load_user_settings(settings_file)
    merged = _apply_managed_storage_layout({**existing, **{key: value for key, value in values.items() if value is not None}})
    settings_file.parent.mkdir(parents=True, exist_ok=True)
    settings_file.write_text(
        json.dumps(merged, ensure_ascii=False, indent=2, sort_keys=True),
        encoding="utf-8",
    )


def serialize_settings(settings: Settings) -> dict:
    # Local import avoids a module cycle: qwen_runtime reads the Settings type.
    from tts_api.qwen_runtime import runtime_status as qwen_runtime_status

    audio_enhancement_runtime_installed = settings.audio_enhancement_python.is_file()
    deepfilternet3_model_installed = (
        (settings.deepfilternet3_root / "config.ini").is_file()
        and (settings.deepfilternet3_root / "checkpoints").is_dir()
    )
    mossformer2_se_model_installed = (
        (settings.mossformer2_se_root / "last_best_checkpoint").is_file()
        and (settings.mossformer2_se_root / "last_best_checkpoint.pt").is_file()
    )
    separation_root = settings.audio_separation_root
    separation_runtime_installed = settings.audio_separation_python.is_file()
    separation_mdx_vocals_installed = (
        (separation_root / "UVR-MDX-NET-Voc_FT.onnx").is_file()
        and (separation_root / "model_data" / "model_data.json").is_file()
    )
    separation_mdx_karaoke_installed = (
        (separation_root / "UVR_MDXNET_KARA_2.onnx").is_file()
        and (separation_root / "model_data" / "model_data.json").is_file()
    )
    separation_mdx23c_installed = (
        (separation_root / "MDX23C-8KFFT-InstVoc_HQ.ckpt").is_file()
        and (separation_root / "model_data" / "mdx_c_configs" / "model_2_stem_full_band_8k.yaml").is_file()
    )

    return {
        "api_host": settings.api_host,
        "api_port": settings.api_port,
        "api_access_key_required": bool(settings.api_access_key),
        "storage_root": str(settings.storage_root),
        "output_dir": str(settings.output_dir),
        "model_store_root": str(MODEL_STORE_ROOT),
        "indextts2_root": str(settings.indextts2_root),
        "indextts2_idle_timeout_seconds": settings.indextts2_idle_timeout_seconds,
        "local_api_idle_timeout_seconds": settings.local_api_idle_timeout_seconds,
        "sensevoice_python": str(settings.sensevoice_python),
        "sensevoice_model_dir": str(settings.sensevoice_model_dir),
        "sensevoice_model_installed": settings.sensevoice_model_dir.is_dir(),
        "sensevoice_runtime_installed": settings.sensevoice_python.is_file(),
        "sensevoice_ready": settings.sensevoice_model_dir.is_dir() and settings.sensevoice_python.is_file(),
        "sensevoice_api_host": settings.sensevoice_api_host,
        "sensevoice_api_port": settings.sensevoice_api_port,
        "sensevoice_device": settings.sensevoice_device,
        "sensevoice_idle_timeout_seconds": settings.sensevoice_idle_timeout_seconds,
        "voxcpm2_root": str(settings.voxcpm2_root),
        "voxcpm2_api_host": settings.voxcpm2_api_host,
        "voxcpm2_api_port": settings.voxcpm2_api_port,
        "voxcpm2_streaming_api_host": settings.voxcpm2_streaming_api_host,
        "voxcpm2_streaming_api_port": settings.voxcpm2_streaming_api_port,
        "gptsovits_root": str(settings.gptsovits_root),
        "gptsovits_api_host": settings.gptsovits_api_host,
        "gptsovits_api_port": settings.gptsovits_api_port,
        "doubao_timeout_seconds": settings.doubao_timeout_seconds,
        "doubao_retry_count": settings.doubao_retry_count,
        "doubao_request_interval_delay_seconds": settings.doubao_request_interval_delay_seconds,
        "legado_timeout_seconds": settings.legado_timeout_seconds,
        "book_cache_concurrency": settings.book_cache_concurrency,
        "doubao_cookie_configured": settings.doubao_cookie_file.exists(),
        "doubao_data_dir": str(settings.doubao_data_dir),
        "ffmpeg_path": settings.ffmpeg_path,
        "asr_backend": settings.asr_backend,
        "audio_enhancement_python": str(settings.audio_enhancement_python),
        "audio_enhancement_runtime_installed": audio_enhancement_runtime_installed,
        "audio_enhancement_device": settings.audio_enhancement_device,
        "deepfilternet3_root": str(settings.deepfilternet3_root),
        "deepfilternet3_model_installed": deepfilternet3_model_installed,
        "mossformer2_se_root": str(settings.mossformer2_se_root),
        "mossformer2_se_model_installed": mossformer2_se_model_installed,
        "audio_enhancement_ready": (
            audio_enhancement_runtime_installed
            and deepfilternet3_model_installed
            and mossformer2_se_model_installed
        ),
        "audio_separation_python": str(settings.audio_separation_python),
        "audio_separation_runtime_installed": separation_runtime_installed,
        "audio_separation_root": str(separation_root),
        "audio_separation_device": settings.audio_separation_device,
        "audio_separation_mdx_vocals_installed": separation_mdx_vocals_installed,
        "audio_separation_mdx_karaoke_installed": separation_mdx_karaoke_installed,
        "audio_separation_mdx23c_installed": separation_mdx23c_installed,
        "audio_separation_ready": separation_runtime_installed and any(
            (separation_mdx_vocals_installed, separation_mdx_karaoke_installed, separation_mdx23c_installed)
        ),
        "qwen_asr_python": str(settings.qwen_asr_python),
        "qwen_cuda_python": str(settings.qwen_cuda_python),
        "qwen_cuda_backend_dir": str(settings.qwen_cuda_backend_dir),
        "qwen_asr_capswriter_root": str(settings.qwen_asr_capswriter_root) if settings.qwen_asr_capswriter_root else None,
        "qwen_asr_model_dir": str(settings.qwen_asr_model_dir),
        "qwen_asr_model_installed": bool(
            settings.qwen_asr_capswriter_root
            and settings.qwen_asr_capswriter_root.is_dir()
            and settings.qwen_asr_model_dir.is_dir()
            and settings.qwen_asr_python.is_file()
        ),
        "qwen_asr_device": settings.qwen_asr_device,
        "qwen_runtime": qwen_runtime_status(settings),
        "alignment_model_installed": bool(
            settings.alignment_aligner_model_dir
            and settings.alignment_aligner_model_dir.is_dir()
        ),
        "alignment_ready": bool(
            settings.alignment_aligner_model_dir
            and settings.alignment_aligner_model_dir.is_dir()
            and settings.alignment_capswriter_root
            and settings.alignment_capswriter_root.is_dir()
            and settings.alignment_python.is_file()
        ),
        "alignment_device": settings.alignment_device,
        "alignment_model_version": settings.alignment_model_version,
        "default_model_id": settings.default_model_id,
        "prewarm_default_model_on_startup": settings.prewarm_default_model_on_startup,
        "model_instances": settings.model_instances,
        "settings_file": str(settings.settings_file),
        "restart_required_fields": RESTART_REQUIRED_FIELDS,
    }


@lru_cache
def get_settings() -> Settings:
    settings = Settings()
    user_settings = load_user_settings(settings.settings_file)
    if user_settings:
        settings = Settings(**{**settings.model_dump(), **user_settings})
    settings.output_dir.mkdir(parents=True, exist_ok=True)
    settings.doubao_data_dir.mkdir(parents=True, exist_ok=True)
    return settings
