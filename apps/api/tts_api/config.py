from functools import lru_cache
import json
import os
from pathlib import Path

from pydantic import BaseModel, Field


WORKSPACE_ROOT = Path(__file__).resolve().parents[3]
DEFAULT_SETTINGS_FILE = WORKSPACE_ROOT / "data" / "config" / "user-settings.json"
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
    "gptsovits_root",
    "gptsovits_api_host",
    "gptsovits_api_port",
    "model_instances",
}
RESTART_REQUIRED_FIELDS = ["api_host", "api_port"]


class Settings(BaseModel):
    app_name: str = "Open TTS Desktop API"
    api_host: str = Field(default_factory=lambda: os.environ.get("OPEN_TTS_API_HOST", "127.0.0.1"))
    api_port: int = Field(default_factory=lambda: int(os.environ.get("OPEN_TTS_API_PORT", "8765")))
    api_access_key: str | None = Field(default_factory=lambda: os.environ.get("OPEN_TTS_API_KEY") or None)
    workspace_root: Path = WORKSPACE_ROOT
    output_dir: Path = Field(default_factory=lambda: Path(os.environ.get("OPEN_TTS_OUTPUT_DIR", str(WORKSPACE_ROOT / "data" / "outputs"))))
    model_registry_path: Path = WORKSPACE_ROOT / "model-registry" / "models.json"
    settings_file: Path = Field(default_factory=lambda: Path(os.environ.get("OPEN_TTS_SETTINGS_FILE", str(DEFAULT_SETTINGS_FILE))))
    voice_library_file: Path = Field(default_factory=lambda: Path(os.environ.get("OPEN_TTS_VOICE_LIBRARY_FILE", str(WORKSPACE_ROOT / "data" / "config" / "voices.json"))))
    projects_file: Path = Field(default_factory=lambda: Path(os.environ.get("OPEN_TTS_PROJECTS_FILE", str(WORKSPACE_ROOT / "data" / "config" / "projects.json"))))
    model_packages_file: Path = Field(default_factory=lambda: Path(os.environ.get("OPEN_TTS_MODEL_PACKAGES_FILE", str(WORKSPACE_ROOT / "data" / "config" / "model-packages.json"))))
    indextts2_root: Path = Field(default_factory=lambda: Path(os.environ.get("OPEN_TTS_INDEXTTS2_ROOT", r"D:\AI\IndexTTS2")))
    indextts2_idle_timeout_seconds: int = Field(default_factory=lambda: int(os.environ.get("OPEN_TTS_INDEXTTS2_IDLE_SECONDS", "600")))
    local_api_idle_timeout_seconds: int = Field(default_factory=lambda: int(os.environ.get("OPEN_TTS_LOCAL_API_IDLE_SECONDS", "600")))
    voxcpm2_root: Path = Field(default_factory=lambda: Path(os.environ.get("OPEN_TTS_VOXCPM2_ROOT", r"E:\Downloads_Sorted_2026-04-16\Folders\VoxCPM2\VoxCPM2")))
    voxcpm2_api_host: str = Field(default_factory=lambda: os.environ.get("OPEN_TTS_VOXCPM2_API_HOST", "127.0.0.1"))
    voxcpm2_api_port: int = Field(default_factory=lambda: int(os.environ.get("OPEN_TTS_VOXCPM2_API_PORT", "8000")))
    gptsovits_root: Path = Field(default_factory=lambda: Path(os.environ.get("OPEN_TTS_GPTSOVITS_ROOT", r"D:\newworld\Shinsekai\data\tts_bundles\installed\GPT-SoVITS-v2pro-20250604")))
    gptsovits_api_host: str = Field(default_factory=lambda: os.environ.get("OPEN_TTS_GPTSOVITS_API_HOST", "127.0.0.1"))
    gptsovits_api_port: int = Field(default_factory=lambda: int(os.environ.get("OPEN_TTS_GPTSOVITS_API_PORT", "9880")))
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
        "indextts2_root": str(settings.indextts2_root),
        "indextts2_idle_timeout_seconds": settings.indextts2_idle_timeout_seconds,
        "local_api_idle_timeout_seconds": settings.local_api_idle_timeout_seconds,
        "voxcpm2_root": str(settings.voxcpm2_root),
        "voxcpm2_api_host": settings.voxcpm2_api_host,
        "voxcpm2_api_port": settings.voxcpm2_api_port,
        "gptsovits_root": str(settings.gptsovits_root),
        "gptsovits_api_host": settings.gptsovits_api_host,
        "gptsovits_api_port": settings.gptsovits_api_port,
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
    return settings
