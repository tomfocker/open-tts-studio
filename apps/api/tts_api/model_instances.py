from datetime import datetime, timezone
from enum import StrEnum
from pathlib import Path
from typing import Any

from pydantic import BaseModel, Field

from tts_api.config import Settings, get_settings, save_user_settings


class RuntimeType(StrEnum):
    worker_lazy_pack = "worker_lazy_pack"
    lazy_pack_api = "lazy_pack_api"
    reserved = "reserved"


class ModelInstanceStatus(StrEnum):
    ready = "ready"
    untested = "untested"
    missing = "missing"
    broken = "broken"
    disabled = "disabled"


class ModelInstanceProfile(BaseModel):
    model_id: str
    display_name: str
    enabled: bool = True
    runtime_type: RuntimeType
    root_path: Path | None = None
    api_host: str | None = None
    api_port: int | None = Field(default=None, ge=1024, le=65535)
    package_label: str | None = Field(default=None, max_length=120)
    user_note: str | None = Field(default=None, max_length=500)
    status: ModelInstanceStatus = ModelInstanceStatus.untested
    last_health_check_at: datetime | None = None
    last_success_at: datetime | None = None
    last_error: str | None = None
    health_history: list["ModelHealthHistoryEntry"] = Field(default_factory=list)

    def serializable(self) -> dict[str, Any]:
        payload = self.model_dump(mode="json")
        if self.root_path is not None:
            payload["root_path"] = str(self.root_path)
        return payload


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class ModelHealthCheck(BaseModel):
    id: str
    label: str
    passed: bool
    detail: str | None = None


class ModelHealthResult(BaseModel):
    model_id: str
    status: ModelInstanceStatus
    checks: list[ModelHealthCheck]
    repair_hint: str | None = None
    checked_at: datetime = Field(default_factory=utc_now)


class ModelHealthHistoryEntry(BaseModel):
    status: ModelInstanceStatus
    checked_at: datetime
    repair_hint: str | None = None
    failed_check_ids: list[str] = Field(default_factory=list)


def build_default_model_instances(settings: Settings) -> list[ModelInstanceProfile]:
    return [
        ModelInstanceProfile(
            model_id="indextts2",
            display_name="IndexTTS2",
            runtime_type=RuntimeType.worker_lazy_pack,
            root_path=settings.indextts2_root,
        ),
        ModelInstanceProfile(
            model_id="voxcpm2",
            display_name="VoxCPM2",
            runtime_type=RuntimeType.lazy_pack_api,
            root_path=settings.voxcpm2_root,
            api_host=settings.voxcpm2_api_host,
            api_port=settings.voxcpm2_api_port,
        ),
        ModelInstanceProfile(
            model_id="gptsovits",
            display_name="GPT-SoVITS",
            runtime_type=RuntimeType.lazy_pack_api,
            root_path=settings.gptsovits_root,
            api_host=settings.gptsovits_api_host,
            api_port=settings.gptsovits_api_port,
        ),
        ModelInstanceProfile(
            model_id="f5-tts",
            display_name="F5-TTS",
            enabled=False,
            runtime_type=RuntimeType.reserved,
            root_path=None,
            status=ModelInstanceStatus.disabled,
            last_error="F5-TTS adapter is reserved and not connected yet.",
        ),
    ]


def _coerce_profile_update(model_id: str, display_name: str, runtime_type: RuntimeType, value: dict) -> ModelInstanceProfile:
    return ModelInstanceProfile.model_validate(
        {
            "model_id": model_id,
            "display_name": value.get("display_name", display_name),
            "runtime_type": value.get("runtime_type", runtime_type),
            **value,
        }
    )


def merge_model_instance_updates(
    defaults: list[ModelInstanceProfile],
    updates: dict[str, dict] | None,
) -> list[ModelInstanceProfile]:
    if not updates:
        return defaults
    merged: list[ModelInstanceProfile] = []
    for default in defaults:
        update = updates.get(default.model_id)
        if update is None:
            merged.append(default)
            continue
        merged.append(
            _coerce_profile_update(
                default.model_id,
                default.display_name,
                default.runtime_type,
                {**default.serializable(), **update},
            )
        )
    return merged


def list_model_instances(settings: Settings | None = None) -> list[ModelInstanceProfile]:
    active_settings = settings or get_settings()
    return merge_model_instance_updates(
        build_default_model_instances(active_settings),
        active_settings.model_instances,
    )


def get_model_instance(model_id: str, settings: Settings | None = None) -> ModelInstanceProfile:
    for instance in list_model_instances(settings):
        if instance.model_id == model_id:
            return instance
    raise KeyError(model_id)


def persist_model_instance(instance: ModelInstanceProfile, settings: Settings | None = None) -> ModelInstanceProfile:
    active_settings = settings or get_settings()
    existing = dict(active_settings.model_instances)
    existing[instance.model_id] = instance.serializable()
    save_user_settings(active_settings.settings_file, {"model_instances": existing})
    get_settings.cache_clear()
    return get_model_instance(instance.model_id)


def update_model_instance(model_id: str, values: dict, settings: Settings | None = None) -> ModelInstanceProfile:
    current = get_model_instance(model_id, settings=settings)
    payload = {**current.serializable(), **values}
    updated = ModelInstanceProfile.model_validate(payload)
    if not updated.enabled:
        updated.status = ModelInstanceStatus.disabled
    elif updated.status == ModelInstanceStatus.disabled:
        updated.status = ModelInstanceStatus.untested
    return persist_model_instance(updated, settings=settings)


def append_health_history(
    instance: ModelInstanceProfile,
    result: ModelHealthResult,
    limit: int = 8,
) -> ModelInstanceProfile:
    entry = ModelHealthHistoryEntry(
        status=result.status,
        checked_at=result.checked_at,
        repair_hint=result.repair_hint,
        failed_check_ids=[check.id for check in result.checks if not check.passed],
    )
    return instance.model_copy(update={"health_history": [entry, *instance.health_history[: limit - 1]]})


def apply_model_instance_to_settings(settings: Settings, instance: ModelInstanceProfile) -> Settings:
    if not instance.enabled:
        raise ValueError(f"Model instance is disabled: {instance.model_id}")
    values = settings.model_dump()
    if instance.model_id == "indextts2" and instance.root_path is not None:
        values["indextts2_root"] = instance.root_path
    elif instance.model_id == "voxcpm2" and instance.root_path is not None:
        values["voxcpm2_root"] = instance.root_path
        if instance.api_host:
            values["voxcpm2_api_host"] = instance.api_host
        if instance.api_port:
            values["voxcpm2_api_port"] = instance.api_port
    elif instance.model_id == "gptsovits" and instance.root_path is not None:
        values["gptsovits_root"] = instance.root_path
        if instance.api_host:
            values["gptsovits_api_host"] = instance.api_host
        if instance.api_port:
            values["gptsovits_api_port"] = instance.api_port
    return Settings(**values)


def mark_model_instance_success(model_id: str, settings: Settings | None = None) -> None:
    try:
        instance = get_model_instance(model_id, settings=settings)
    except KeyError:
        return
    updated = instance.model_copy(
        update={
            "status": ModelInstanceStatus.ready,
            "last_success_at": utc_now(),
            "last_error": None,
        }
    )
    persist_model_instance(updated, settings=settings)
