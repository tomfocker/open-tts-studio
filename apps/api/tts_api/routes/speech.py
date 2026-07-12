import threading
from typing import Callable

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
from tts_api.jobs import run_tracked_synthesis
from tts_api.registry import ModelRegistry
from tts_api.schemas import SpeechRequest, SpeechResult

router = APIRouter()

ProgressReporter = Callable[[str, int, str], None]
_synthesis_lock = threading.Lock()


def _report_progress(reporter: ProgressReporter | None, stage: str, progress: int, message: str) -> None:
    if reporter is None:
        return
    try:
        reporter(stage, progress, message)
    except Exception:
        return


def synthesize_with_registered_adapter(
    request: SpeechRequest,
    progress_reporter: ProgressReporter | None = None,
) -> SpeechResult:
    _report_progress(progress_reporter, "validating", 8, "正在校验请求、模型能力与本地配置。")
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

    _report_progress(progress_reporter, "waiting_generation_slot", 18, "正在等待本地串行生成槽位。")
    with _synthesis_lock:
        _report_progress(progress_reporter, "starting_adapter", 35, "适配器已启动，模型正在处理请求。")
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
    _report_progress(progress_reporter, "finalizing", 90, "模型已返回结果，正在整理音频与任务记录。")
    if instance is not None:
        mark_model_instance_success(request.model, settings=get_settings())
    return result


@router.post("/v1/audio/speech", response_model=SpeechResult)
def openai_compatible_speech(request: SpeechRequest) -> SpeechResult:
    return run_tracked_synthesis(request, synthesize_with_registered_adapter)


@router.post("/v1/tts/speech", response_model=SpeechResult)
def tts_speech(request: SpeechRequest) -> SpeechResult:
    return run_tracked_synthesis(request, synthesize_with_registered_adapter)
