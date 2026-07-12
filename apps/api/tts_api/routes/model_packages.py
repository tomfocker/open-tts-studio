from fastapi import APIRouter, HTTPException

from tts_api.config import get_settings
from tts_api.model_packages import (
    ModelPackageCreate,
    ModelPackageRecord,
    ModelPackageUpdate,
    get_model_package_store,
    list_model_packages,
)


router = APIRouter()


@router.get("/v1/model-packages")
def get_model_packages() -> dict:
    return {"packages": [package.serializable() for package in list_model_packages()]}


@router.post("/v1/model-packages", response_model=ModelPackageRecord, status_code=201)
def register_model_package(payload: ModelPackageCreate) -> ModelPackageRecord:
    settings = get_settings()
    try:
        return get_model_package_store(settings).register(payload, settings)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"Unknown model instance: {payload.model_id}")
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))


@router.get("/v1/model-packages/{package_id}", response_model=ModelPackageRecord)
def get_model_package(package_id: str) -> ModelPackageRecord:
    package = get_model_package_store().get(package_id)
    if package is None:
        raise HTTPException(status_code=404, detail="Model package not found")
    return package


@router.patch("/v1/model-packages/{package_id}", response_model=ModelPackageRecord)
def update_registered_model_package(package_id: str, update: ModelPackageUpdate) -> ModelPackageRecord:
    try:
        return get_model_package_store().update(package_id, update)
    except KeyError:
        raise HTTPException(status_code=404, detail="Model package not found")
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))


@router.post("/v1/model-packages/{package_id}/inspect", response_model=ModelPackageRecord)
def inspect_registered_model_package(package_id: str) -> ModelPackageRecord:
    try:
        settings = get_settings()
        return get_model_package_store(settings).inspect(package_id, settings)
    except KeyError:
        raise HTTPException(status_code=404, detail="Model package not found")


@router.post("/v1/model-packages/{package_id}/activate")
def activate_registered_model_package(package_id: str) -> dict:
    settings = get_settings()
    try:
        package, instance = get_model_package_store(settings).activate(package_id, settings)
    except KeyError:
        raise HTTPException(status_code=404, detail="Model package not found")
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    return {"package": package.serializable(), "instance": instance.serializable()}
