from typing import Callable

from fastapi import APIRouter, HTTPException

from tts_api.adapters.f5_tts import F5TtsAdapter
from tts_api.adapters.gptsovits import GptSoVitsAdapter
from tts_api.adapters.indextts2 import IndexTts2Adapter
from tts_api.adapters.mock import MockTtsAdapter
from tts_api.adapters.voxcpm2 import VoxCpm2Adapter
from tts_api.adapters.doubao_web import DoubaoWebAdapter
from tts_api.config import get_settings
from tts_api.errors import unknown_model_error, unsupported_adapter_error
from tts_api.model_health import check_model_instance
from tts_api.model_instances import get_model_instance, mark_model_instance_success
from tts_api.model_capabilities import validate_speech_request_capabilities
from tts_api.jobs import run_tracked_synthesis
from tts_api.registry import ModelRegistry
from tts_api.runtime_memory import is_realtime_runtime_reserved, local_gpu_generation_lock, release_conflicting_runtimes, resolve_runtime_settings
from tts_api.schemas import SpeechRequest, SpeechResult

router = APIRouter()

ProgressReporter = Callable[[str, int, str], None]
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

    # A realtime session reserves the GPU for Whispera's VoxCPM2 worker. Do
    # not let an ordinary local synthesis request tear that worker down and
    # replace it with a different engine while the conversation is alive.
    if is_realtime_runtime_reserved() and model.adapter not in {"doubao_web", "mock"}:
        raise HTTPException(status_code=409, detail="实时语音模式正在独占 GPU；请先退出实时工作区再使用普通生成引擎。")

    try:
        validate_speech_request_capabilities(model, request)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    try:
        instance = get_model_instance(request.model, settings=settings)
        if not instance.enabled:
            raise HTTPException(status_code=409, detail=f"Model instance is disabled: {request.model}")
        health = check_model_instance(instance)
        if health.status != "ready":
            raise HTTPException(status_code=409, detail=health.repair_hint or "模型目录尚未通过检查。")
        settings = resolve_runtime_settings(settings)
    except KeyError:
        instance = None
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    def synthesize_adapter() -> SpeechResult:
        if model.adapter == "mock":
            return MockTtsAdapter(settings=settings).synthesize(request)
        if model.adapter == "voxcpm2":
            return VoxCpm2Adapter(settings=settings).synthesize(request)
        if model.adapter == "f5_tts":
            return F5TtsAdapter(settings=settings).synthesize(request)
        if model.adapter == "gptsovits":
            return GptSoVitsAdapter(settings=settings).synthesize(request)
        if model.adapter == "indextts2":
            return IndexTts2Adapter(settings=settings).synthesize(request)
        if model.adapter == "doubao_web":
            return DoubaoWebAdapter(settings=settings).synthesize(request)
        raise unsupported_adapter_error(model.adapter)

    if model.adapter == "doubao_web":
        # Cloud synthesis never loads a local model or uses VRAM. Its adapter
        # has a dedicated cookie/request throttler, so holding the shared GPU
        # lock here only made cloud jobs wait behind unrelated local inference.
        _report_progress(progress_reporter, "waiting_cloud_request", 18, "正在等待豆包请求配额，不占用本地 GPU。")
        _report_progress(progress_reporter, "preparing_cloud", 26, "正在检查豆包账号、音色与云端请求参数；本地模型保持不变。")
        _report_progress(progress_reporter, "starting_adapter", 35, "豆包云端正在合成语音。")
        result = synthesize_adapter()
    else:
        _report_progress(progress_reporter, "waiting_generation_slot", 18, "正在等待本地串行生成槽位。")
        with local_gpu_generation_lock:
            _report_progress(progress_reporter, "preparing_memory", 26, "正在检查并整理其他模型的显存占用。")
            try:
                released_models = release_conflicting_runtimes(request.model, settings)
            except RuntimeError as exc:
                raise HTTPException(status_code=409, detail=str(exc))
            if released_models:
                _report_progress(
                    progress_reporter,
                    "preparing_memory",
                    32,
                    f"已释放 {', '.join(released_models)}，正在加载 {model.display_name}。",
                )
            _report_progress(progress_reporter, "starting_adapter", 35, "适配器已启动，模型正在处理请求。")
            result = synthesize_adapter()

    _report_progress(progress_reporter, "finalizing", 90, "模型已返回结果，正在整理音频与任务记录。")
    if instance is not None:
        mark_model_instance_success(request.model, settings=get_settings())
    return result


@router.post("/v1/audio/speech", response_model=SpeechResult, response_model_exclude_none=True)
def openai_compatible_speech(request: SpeechRequest) -> SpeechResult:
    return run_tracked_synthesis(request, synthesize_with_registered_adapter)


@router.post("/v1/tts/speech", response_model=SpeechResult, response_model_exclude_none=True)
def tts_speech(request: SpeechRequest) -> SpeechResult:
    return run_tracked_synthesis(request, synthesize_with_registered_adapter)
