from fastapi import APIRouter

from tts_api.config import get_settings

router = APIRouter()


@router.get("/v1/health")
def health() -> dict[str, object]:
    settings = get_settings()
    return {
        "status": "ok",
        "service": settings.app_name,
        "port": settings.api_port,
    }
