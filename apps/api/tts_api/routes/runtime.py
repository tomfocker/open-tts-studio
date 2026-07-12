from fastapi import APIRouter, HTTPException

from tts_api.adapters.gptsovits import get_gptsovits_service_manager, get_gptsovits_status, release_gptsovits_service
from tts_api.adapters.indextts2_worker import get_indextts2_worker_client, get_indextts2_worker_status, release_indextts2_worker
from tts_api.adapters.voxcpm2 import get_voxcpm2_service_manager, get_voxcpm2_status, release_voxcpm2_service
from tts_api.config import Settings, get_settings
from tts_api.model_health import check_model_instance
from tts_api.model_instances import ModelInstanceStatus, apply_model_instance_to_settings, get_model_instance

router = APIRouter()


def _model_runtime_settings(model_id: str, require_enabled: bool = True) -> Settings:
    settings = get_settings()
    try:
        instance = get_model_instance(model_id, settings=settings)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"Unknown model instance: {model_id}")
    if require_enabled and not instance.enabled:
        raise HTTPException(status_code=409, detail=f"Model instance is disabled: {model_id}")
    if not instance.enabled:
        instance = instance.model_copy(update={"enabled": True})
    return apply_model_instance_to_settings(settings, instance)


def _worker_status(model_id: str, settings: Settings) -> dict:
    if model_id == "indextts2":
        return get_indextts2_worker_status(settings)
    if model_id == "voxcpm2":
        return get_voxcpm2_status(settings)
    if model_id == "gptsovits":
        return get_gptsovits_status(settings)
    raise HTTPException(status_code=404, detail=f"Runtime controls are not available for: {model_id}")


def _assert_startable(model_id: str) -> Settings:
    settings = _model_runtime_settings(model_id)
    instance = get_model_instance(model_id, settings=get_settings())
    health = check_model_instance(instance)
    if health.status != ModelInstanceStatus.ready:
        raise HTTPException(status_code=409, detail=health.repair_hint or "模型目录尚未通过检查。")
    return settings


@router.post("/v1/runtime/models/{model_id}/start")
def start_model_runtime(model_id: str) -> dict:
    settings = _assert_startable(model_id)
    try:
        if model_id == "indextts2":
            get_indextts2_worker_client(settings).start()
        elif model_id == "voxcpm2":
            manager = get_voxcpm2_service_manager(settings)
            if not manager.is_healthy():
                manager.start()
        elif model_id == "gptsovits":
            manager = get_gptsovits_service_manager(settings)
            if not manager.is_healthy():
                manager.start()
        else:
            raise HTTPException(status_code=404, detail=f"Runtime controls are not available for: {model_id}")
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"启动 {model_id} 失败：{exc}")
    return {"model_id": model_id, "action": "start", "worker": _worker_status(model_id, settings)}


@router.post("/v1/runtime/models/{model_id}/stop")
def stop_model_runtime(model_id: str) -> dict:
    settings = _model_runtime_settings(model_id, require_enabled=False)
    status = _worker_status(model_id, settings)
    if status.get("active_requests", 0) > 0:
        raise HTTPException(status_code=409, detail="模型正在生成，暂不能释放运行时。")
    if not status.get("managed", False):
        if status.get("loaded", False):
            raise HTTPException(status_code=409, detail="检测到外部运行的服务，为避免误关闭，本软件不会结束它。")
        return {"model_id": model_id, "action": "stop", "released": False, "worker": status}
    if model_id == "indextts2":
        released = release_indextts2_worker(settings)
    elif model_id == "voxcpm2":
        released = release_voxcpm2_service(settings)
    elif model_id == "gptsovits":
        released = release_gptsovits_service(settings)
    else:
        raise HTTPException(status_code=404, detail=f"Runtime controls are not available for: {model_id}")
    return {
        "model_id": model_id,
        "action": "stop",
        "released": released,
        "worker": _worker_status(model_id, settings),
    }
