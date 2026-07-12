from fastapi import APIRouter

from tts_api.config import get_settings
from tts_api.registry import ModelRegistry
from tts_api.schemas import ModelInfo

router = APIRouter()


@router.get("/v1/tts/models", response_model=list[ModelInfo])
def list_models() -> list[ModelInfo]:
    settings = get_settings()
    registry = ModelRegistry(settings.model_registry_path)
    return registry.list_models()
