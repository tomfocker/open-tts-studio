from fastapi import APIRouter

from tts_api.config import get_settings
from tts_api.model_instances import list_model_instances
from tts_api.registry import ModelRegistry
from tts_api.schemas import ModelInfo

router = APIRouter()


@router.get("/v1/tts/models", response_model=list[ModelInfo])
def list_models() -> list[ModelInfo]:
    settings = get_settings()
    registry = ModelRegistry(settings.model_registry_path)
    return registry.list_models(include_internal=False)


@router.get("/v1/tts/capabilities")
def list_model_capabilities() -> dict:
    settings = get_settings()
    registry = ModelRegistry(settings.model_registry_path)
    instances = {instance.model_id: instance for instance in list_model_instances(settings)}
    models = registry.list_models(include_internal=False)
    return {
        "response_formats": ["wav", "mp3"],
        "streaming": False,
        "models": [
            {
                "model": model.model_dump(mode="json"),
                "instance": instances[model.id].serializable() if model.id in instances else None,
                "accepted_parameters": ["input", *model.request_capabilities],
                "response_formats": ["wav", "mp3"] if model.adapter == "doubao_web" else ["wav"],
                "requires_reference_audio": model.requires_reference_audio,
            }
            for model in models
        ],
    }
