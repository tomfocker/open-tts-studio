from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from tts_api.model_health import check_model_instance
from tts_api.model_instances import (
    ModelInstanceProfile,
    append_health_history,
    get_model_instance,
    list_model_instances,
    persist_model_instance,
    update_model_instance,
)

router = APIRouter()


class ModelInstanceUpdate(BaseModel):
    enabled: bool | None = None
    root_path: Path | None = None
    api_host: str | None = None
    api_port: int | None = Field(default=None, ge=1024, le=65535)
    package_label: str | None = Field(default=None, max_length=120)
    user_note: str | None = Field(default=None, max_length=500)


@router.get("/v1/model-instances")
def get_model_instances() -> dict:
    return {"instances": [instance.serializable() for instance in list_model_instances()]}


@router.get("/v1/model-instances/{model_id}")
def get_one_model_instance(model_id: str) -> dict:
    try:
        return get_model_instance(model_id).serializable()
    except KeyError:
        raise HTTPException(status_code=404, detail=f"Unknown model instance: {model_id}")


@router.patch("/v1/model-instances/{model_id}", response_model=ModelInstanceProfile)
def patch_model_instance(model_id: str, update: ModelInstanceUpdate) -> ModelInstanceProfile:
    try:
        return update_model_instance(model_id, update.model_dump(exclude_unset=True))
    except KeyError:
        raise HTTPException(status_code=404, detail=f"Unknown model instance: {model_id}")


@router.post("/v1/model-instances/{model_id}/check")
def check_one_model_instance(model_id: str) -> dict:
    try:
        instance = get_model_instance(model_id)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"Unknown model instance: {model_id}")
    result = check_model_instance(instance)
    updated = append_health_history(instance, result).model_copy(
        update={
            "status": result.status,
            "last_health_check_at": result.checked_at,
            "last_error": result.repair_hint,
        }
    )
    persist_model_instance(updated)
    return result.model_dump(mode="json")
