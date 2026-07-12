from pathlib import Path

from fastapi import APIRouter
from pydantic import BaseModel, Field

from tts_api.config import get_settings, save_user_settings, serialize_settings

router = APIRouter()

MODEL_INSTANCE_SETTING_FIELDS = {
    "indextts2_root": ("indextts2", "root_path"),
    "voxcpm2_root": ("voxcpm2", "root_path"),
    "voxcpm2_api_host": ("voxcpm2", "api_host"),
    "voxcpm2_api_port": ("voxcpm2", "api_port"),
    "gptsovits_root": ("gptsovits", "root_path"),
    "gptsovits_api_host": ("gptsovits", "api_host"),
    "gptsovits_api_port": ("gptsovits", "api_port"),
}


class SettingsUpdate(BaseModel):
    api_host: str | None = None
    api_port: int | None = Field(default=None, ge=1024, le=65535)
    output_dir: Path | None = None
    indextts2_root: Path | None = None
    indextts2_idle_timeout_seconds: int | None = Field(default=None, ge=30, le=86400)
    local_api_idle_timeout_seconds: int | None = Field(default=None, ge=30, le=86400)
    voxcpm2_root: Path | None = None
    voxcpm2_api_host: str | None = None
    voxcpm2_api_port: int | None = Field(default=None, ge=1024, le=65535)
    gptsovits_root: Path | None = None
    gptsovits_api_host: str | None = None
    gptsovits_api_port: int | None = Field(default=None, ge=1024, le=65535)


def sync_model_instance_profiles(settings, values: dict) -> dict | None:
    model_instances = {model_id: dict(profile) for model_id, profile in settings.model_instances.items()}
    touched_model_ids: set[str] = set()
    for setting_key, (model_id, profile_key) in MODEL_INSTANCE_SETTING_FIELDS.items():
        if setting_key not in values:
            continue
        value = values[setting_key]
        profile = model_instances.setdefault(model_id, {})
        profile[profile_key] = str(value) if isinstance(value, Path) else value
        touched_model_ids.add(model_id)

    for model_id in touched_model_ids:
        profile = model_instances[model_id]
        if profile.get("enabled", True):
            profile["status"] = "untested"
            profile["last_health_check_at"] = None
            profile["last_success_at"] = None
            profile["last_error"] = None
    return model_instances if touched_model_ids else None


@router.get("/v1/settings")
def get_runtime_settings() -> dict:
    return serialize_settings(get_settings())


@router.patch("/v1/settings")
def update_runtime_settings(update: SettingsUpdate) -> dict:
    settings = get_settings()
    values = update.model_dump(exclude_none=True)
    payload = {key: str(value) if isinstance(value, Path) else value for key, value in values.items()}
    model_instances = sync_model_instance_profiles(settings, values)
    if model_instances is not None:
        payload["model_instances"] = model_instances
    save_user_settings(settings.settings_file, payload)
    get_settings.cache_clear()
    return serialize_settings(get_settings())
