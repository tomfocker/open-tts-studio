from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Query

from tts_api.config import get_settings
from tts_api.jobs import get_job_store
from tts_api.projects import get_project_store
from tts_api.schemas import AudioAsset


router = APIRouter()

SUPPORTED_OUTPUT_SUFFIXES = {".wav"}


def _asset_metadata() -> dict[str, dict]:
    metadata: dict[str, dict] = {}
    for job in get_job_store().list(limit=500):
        if job.result is None:
            continue
        metadata.setdefault(
            Path(job.result.file_path).name,
            {
                "source": "speech",
                "model": job.result.model,
                "text": job.request.input,
                "duration_seconds": job.result.duration_seconds,
                "task_id": job.id,
            },
        )
    for project in get_project_store().list():
        for segment in project.segments:
            if segment.result is None:
                continue
            metadata.setdefault(
                Path(segment.result.file_path).name,
                {
                    "source": "batch_project",
                    "model": segment.result.model,
                    "text": segment.text,
                    "duration_seconds": segment.result.duration_seconds,
                    "project_id": project.id,
                    "project_title": project.title,
                },
            )
    return metadata


@router.get("/v1/audio-assets")
def list_audio_assets(limit: int = Query(default=120, ge=1, le=500)) -> dict:
    settings = get_settings()
    metadata = _asset_metadata()
    candidates: list[tuple[Path, int, float]] = []
    try:
        for path in settings.output_dir.iterdir():
            if not path.is_file() or path.suffix.lower() not in SUPPORTED_OUTPUT_SUFFIXES:
                continue
            stat = path.stat()
            candidates.append((path, stat.st_size, stat.st_mtime))
    except OSError:
        candidates = []

    assets: list[AudioAsset] = []
    for path, size, modified_at in sorted(candidates, key=lambda item: item[2], reverse=True)[:limit]:
        details = metadata.get(path.name, {})
        assets.append(
            AudioAsset(
                file_name=path.name,
                file_path=str(path),
                audio_url=f"/outputs/{path.name}",
                file_size_bytes=size,
                modified_at=datetime.fromtimestamp(modified_at, tz=timezone.utc),
                **details,
            )
        )
    return {"assets": [asset.model_dump(mode="json") for asset in assets]}
