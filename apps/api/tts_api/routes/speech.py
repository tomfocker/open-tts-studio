from fastapi import APIRouter, HTTPException

from tts_api.adapters.f5_tts import F5TtsAdapter
from tts_api.adapters.gptsovits import GptSoVitsAdapter
from tts_api.adapters.indextts2 import IndexTts2Adapter
from tts_api.adapters.mock import MockTtsAdapter
from tts_api.adapters.voxcpm2 import VoxCpm2Adapter
from tts_api.config import get_settings
from tts_api.errors import unknown_model_error, unsupported_adapter_error
from tts_api.model_instances import apply_model_instance_to_settings, get_model_instance, mark_model_instance_success
from tts_api.model_capabilities import validate_speech_request_capabilities
from tts_api.registry import ModelRegistry
from tts_api.schemas import SpeechRequest, SpeechResult

router = APIRouter()


def synthesize_with_registered_adapter(request: SpeechRequest) -> SpeechResult:
    settings = get_settings()
    registry = ModelRegistry(settings.model_registry_path)
    try:
        model = registry.get_model(request.model)
    except KeyError:
        raise unknown_model_error(request.model)

    try:
        validate_speech_request_capabilities(model, request)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    try:
        instance = get_model_instance(request.model, settings=settings)
        settings = apply_model_instance_to_settings(settings, instance)
    except KeyError:
        instance = None
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    if model.adapter == "mock":
        result = MockTtsAdapter(settings=settings).synthesize(request)
    elif model.adapter == "voxcpm2":
        result = VoxCpm2Adapter(settings=settings).synthesize(request)
    elif model.adapter == "f5_tts":
        result = F5TtsAdapter(settings=settings).synthesize(request)
    elif model.adapter == "gptsovits":
        result = GptSoVitsAdapter(settings=settings).synthesize(request)
    elif model.adapter == "indextts2":
        result = IndexTts2Adapter(settings=settings).synthesize(request)
    else:
        raise unsupported_adapter_error(model.adapter)
    if instance is not None:
        mark_model_instance_success(request.model, settings=get_settings())
    return result


@router.post("/v1/audio/speech", response_model=SpeechResult)
def openai_compatible_speech(request: SpeechRequest) -> SpeechResult:
    return synthesize_with_registered_adapter(request)


@router.post("/v1/tts/speech", response_model=SpeechResult)
def tts_speech(request: SpeechRequest) -> SpeechResult:
    return synthesize_with_registered_adapter(request)
