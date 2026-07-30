from functools import lru_cache
import json
import os
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, Field


WORKSPACE_ROOT = Path(__file__).resolve().parents[3]
MODEL_STORE_ROOT = WORKSPACE_ROOT / "models"
DEFAULT_INDEXTTS2_ROOT = MODEL_STORE_ROOT / "IndexTTS2"
DEFAULT_VOXCPM2_ROOT = MODEL_STORE_ROOT / "VoxCPM2"
DEFAULT_GPTSOVITS_ROOT = MODEL_STORE_ROOT / "GPT-SoVITS"
DEFAULT_SETTINGS_FILE = WORKSPACE_ROOT / "data" / "config" / "user-settings.json"


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
    output_dir: Path = Field(default_factory=lambda: Path(os.environ.get("OPEN_TTS_OUTPUT_DIR", str(WORKSPACE_ROOT / "data" / "outputs"))))
    model_registry_path: Path = WORKSPACE_ROOT / "model-registry" / "models.json"
    settings_file: Path = Field(default_factory=lambda: Path(os.environ.get("OPEN_TTS_SETTINGS_FILE", str(DEFAULT_SETTINGS_FILE))))
    voice_library_file: Path = Field(default_factory=lambda: Path(os.environ.get("OPEN_TTS_VOICE_LIBRARY_FILE", str(WORKSPACE_ROOT / "data" / "config" / "voices.json"))))
    voice_asset_dir: Path = Field(default_factory=_default_voice_asset_dir)
    voice_export_dir: Path = Field(default_factory=_default_voice_export_dir)
    projects_file: Path = Field(default_factory=lambda: Path(os.environ.get("OPEN_TTS_PROJECTS_FILE", str(WORKSPACE_ROOT / "data" / "config" / "projects.json"))))
    model_packages_file: Path = Field(default_factory=lambda: Path(os.environ.get("OPEN_TTS_MODEL_PACKAGES_FILE", str(WORKSPACE_ROOT / "data" / "config" / "model-packages.json"))))
    tasks_file: Path = Field(default_factory=_default_tasks_file)
    task_log_dir: Path = Field(default_factory=_default_task_log_dir)
    indextts2_root: Path = Field(default_factory=lambda: Path(os.environ.get("OPEN_TTS_INDEXTTS2_ROOT", str(DEFAULT_INDEXTTS2_ROOT))))
    indextts2_idle_timeout_seconds: int = Field(default_factory=lambda: int(os.environ.get("OPEN_TTS_INDEXTTS2_IDLE_SECONDS", "600")))
    local_api_idle_timeout_seconds: int = Field(default_factory=lambda: int(os.environ.get("OPEN_TTS_LOCAL_API_IDLE_SECONDS", "600")))
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
    default_model_id: Literal["indextts2", "voxcpm2", "gptsovits", "doubao-web"] = "indextts2"
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
    return {key: value for key, value in data.items() if key in USER_SETTING_KEYS and value is not None}


def save_user_settings(settings_file: Path, values: dict) -> None:
    existing = load_user_settings(settings_file)
    merged = {**existing, **{key: value for key, value in values.items() if value is not None}}
    settings_file.parent.mkdir(parents=True, exist_ok=True)
    settings_file.write_text(
        json.dumps(merged, ensure_ascii=False, indent=2, sort_keys=True),
        encoding="utf-8",
    )


def serialize_settings(settings: Settings) -> dict:
    return {
        "api_host": settings.api_host,
        "api_port": settings.api_port,
        "api_access_key_required": bool(settings.api_access_key),
        "output_dir": str(settings.output_dir),
        "model_store_root": str(MODEL_STORE_ROOT),
        "indextts2_root": str(settings.indextts2_root),
        "indextts2_idle_timeout_seconds": settings.indextts2_idle_timeout_seconds,
        "local_api_idle_timeout_seconds": settings.local_api_idle_timeout_seconds,
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
