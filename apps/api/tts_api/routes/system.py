from fastapi import APIRouter

from tts_api.config import get_settings
from tts_api.model_instances import list_model_instances
from tts_api.runtime_memory import resolve_runtime_settings, runtime_workers
from tts_api.system_monitor import collect_system_status

router = APIRouter()


@router.get("/v1/system/status")
def system_status() -> dict:
    settings = get_settings()
    runtime_settings = resolve_runtime_settings(settings)
    instances = list_model_instances(settings)
    status = collect_system_status()
    status["workers"] = runtime_workers(runtime_settings)
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
