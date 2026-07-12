from datetime import datetime, timezone
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from tts_api.config import get_settings, save_user_settings, serialize_settings
from tts_api.model_instances import list_model_instances
from tts_api.model_packages import ModelPackageRecord, list_model_packages, replace_model_packages

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

SETTINGS_BACKUP_SCHEMA = "open-tts-studio-settings"
SETTINGS_BACKUP_VERSION = 1


class SettingsBackupValues(BaseModel):
    """The portable subset of settings that is safe to move between PCs."""

    model_config = ConfigDict(extra="forbid")

    api_host: str = Field(min_length=1)
    api_port: int = Field(ge=1024, le=65535)
    output_dir: Path
    indextts2_idle_timeout_seconds: int = Field(ge=30, le=86400)
    local_api_idle_timeout_seconds: int = Field(ge=30, le=86400)


class SettingsBackupModelInstance(BaseModel):
    """Stable model profile fields; health/runtime history deliberately stays local."""

    model_config = ConfigDict(extra="forbid")

    enabled: bool
    root_path: Path | None = None
    api_host: str | None = None
    api_port: int | None = Field(default=None, ge=1024, le=65535)
    package_label: str | None = Field(default=None, max_length=120)
    user_note: str | None = Field(default=None, max_length=500)


class SettingsBackup(BaseModel):
    """Versioned on-disk backup format for settings and stable model profiles."""

    model_config = ConfigDict(extra="forbid")

    backup_schema: Literal["open-tts-studio-settings"] = Field(alias="schema")
    version: Literal[1]
    created_at: datetime
    settings: SettingsBackupValues
    model_instances: dict[str, SettingsBackupModelInstance] = Field(default_factory=dict)
    model_packages: list[ModelPackageRecord] | None = None


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


def build_settings_backup(settings) -> SettingsBackup:
    model_instances: dict[str, SettingsBackupModelInstance] = {}
    for instance in list_model_instances(settings):
        profile = instance.serializable()
        model_instances[instance.model_id] = SettingsBackupModelInstance.model_validate(
            {
                key: profile.get(key)
                for key in ("enabled", "root_path", "api_host", "api_port", "package_label", "user_note")
            }
        )

    return SettingsBackup(
        schema=SETTINGS_BACKUP_SCHEMA,
        version=SETTINGS_BACKUP_VERSION,
        created_at=datetime.now(timezone.utc),
        settings=SettingsBackupValues(
            api_host=settings.api_host,
            api_port=settings.api_port,
            output_dir=settings.output_dir,
            indextts2_idle_timeout_seconds=settings.indextts2_idle_timeout_seconds,
            local_api_idle_timeout_seconds=settings.local_api_idle_timeout_seconds,
        ),
        model_instances=model_instances,
        model_packages=list_model_packages(settings),
    )


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


@router.get("/v1/settings/export", response_model=SettingsBackup, response_model_exclude_none=True)
def export_runtime_settings() -> SettingsBackup:
    """Return safe, versioned migration data without credentials or user media."""

    return build_settings_backup(get_settings())


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


@router.post("/v1/settings/import")
def import_runtime_settings(backup: SettingsBackup) -> dict:
    """Persist one validated backup, replacing only the portable settings subset."""

    settings = get_settings()
    known_model_ids = {instance.model_id for instance in list_model_instances(settings)}
    package_model_ids = {package.model_id for package in backup.model_packages or []}
    unknown_model_ids = sorted((set(backup.model_instances) | package_model_ids) - known_model_ids)
    if unknown_model_ids:
        unknown_labels = "、".join(unknown_model_ids)
        raise HTTPException(status_code=422, detail=f"当前版本无法导入未识别的模型档案：{unknown_labels}")

    payload = backup.settings.model_dump(mode="json")
    payload["model_instances"] = {
        model_id: profile.model_dump(mode="json", exclude_none=True)
        for model_id, profile in backup.model_instances.items()
    }
    save_user_settings(settings.settings_file, payload)
    get_settings.cache_clear()
    imported_settings = get_settings()
    if backup.model_packages is not None:
        replace_model_packages(backup.model_packages, imported_settings)
    return serialize_settings(imported_settings)
