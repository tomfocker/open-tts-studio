from fastapi import APIRouter

from tts_api.adapters.gptsovits import get_gptsovits_status
from tts_api.adapters.indextts2_worker import get_indextts2_worker_status
from tts_api.adapters.voxcpm2 import get_voxcpm2_status
from tts_api.config import get_settings
from tts_api.model_instances import apply_model_instance_to_settings, list_model_instances
from tts_api.system_monitor import collect_system_status

router = APIRouter()


@router.get("/v1/system/status")
def system_status() -> dict:
    settings = get_settings()
    runtime_settings = settings
    instances = list_model_instances(settings)
    for instance in instances:
        if instance.enabled:
            runtime_settings = apply_model_instance_to_settings(runtime_settings, instance)
    status = collect_system_status()
    status["workers"] = {
        "indextts2": get_indextts2_worker_status(runtime_settings),
        "voxcpm2": get_voxcpm2_status(runtime_settings),
        "gptsovits": get_gptsovits_status(runtime_settings),
    }
    status["model_instances"] = {
        instance.model_id: {
            "enabled": instance.enabled,
            "status": instance.status,
            "root_path": str(instance.root_path) if instance.root_path else None,
            "last_health_check_at": instance.last_health_check_at.isoformat() if instance.last_health_check_at else None,
            "last_success_at": instance.last_success_at.isoformat() if instance.last_success_at else None,
            "last_error": instance.last_error,
        }
        for instance in instances
    }
    return status
