from pathlib import Path

from fastapi import APIRouter

from tts_api.config import get_settings
from tts_api.model_instances import list_model_instances

router = APIRouter()


def directory_info(identifier: str, display_name: str, path: Path, kind: str) -> dict:
    return {
        "id": identifier,
        "display_name": display_name,
        "path": str(path),
        "exists": path.exists() and path.is_dir(),
        "kind": kind,
    }


@router.get("/v1/model-directories")
def list_model_directories() -> dict:
    settings = get_settings()
    instances = {instance.model_id: instance for instance in list_model_instances(settings)}
    return {
        "directories": [
            directory_info("indextts2", "IndexTTS2", instances["indextts2"].root_path or settings.indextts2_root, "model_root"),
            directory_info("voxcpm2", "VoxCPM2", instances["voxcpm2"].root_path or settings.voxcpm2_root, "model_root"),
            directory_info("gptsovits", "GPT-SoVITS", instances["gptsovits"].root_path or settings.gptsovits_root, "model_root"),
            directory_info("outputs", "输出目录", settings.output_dir, "output"),
        ]
    }
