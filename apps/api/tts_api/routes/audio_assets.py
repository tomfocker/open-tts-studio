from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import FileResponse

from tts_api.config import get_settings
from tts_api.jobs import get_job_store
from tts_api.projects import get_project_store
from tts_api.enhancement import get_audio_enhancement_store
from tts_api.separation import get_audio_separation_store
from tts_api.schemas import AudioAsset


router = APIRouter()

# Audio produced by the cloud adapter is usually MP3, while the local engines
# generally return WAV.  Treat both as first-class library assets instead of
# making the library's view of the output directory depend on the engine used.
SUPPORTED_OUTPUT_SUFFIXES = {".wav", ".mp3", ".flac", ".m4a", ".ogg"}
MEDIA_TYPES = {
    ".wav": "audio/wav",
    ".mp3": "audio/mpeg",
    ".flac": "audio/flac",
    ".m4a": "audio/mp4",
    ".ogg": "audio/ogg",
}


def _output_root() -> Path:
    return get_settings().output_dir.expanduser().resolve()


def _asset_id(root: Path, path: Path) -> str:
    return path.resolve().relative_to(root).as_posix()


def _resolve_asset_path(asset_id: str) -> Path:
    """Resolve a library id without ever allowing access outside output_dir."""
    root = _output_root()
    candidate = (root / asset_id).resolve()
    try:
        candidate.relative_to(root)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail="音频资产不存在") from exc
    if not candidate.is_file() or candidate.suffix.lower() not in SUPPORTED_OUTPUT_SUFFIXES:
        raise HTTPException(status_code=404, detail="音频资产不存在")
    return candidate


def _origin_for_model(model: str | None) -> str:
    if model == "doubao-web":
        return "cloud"
    return "local"


def _asset_metadata(root: Path) -> dict[str, dict]:
    """Join the output-directory scan to persistent synthesis metadata.

    The file path, rather than only the filename, is the identity.  This keeps
    nested folders in a monitored output directory safe from name collisions.
    Old records that point outside the current output directory are ignored.
    """
    metadata: dict[str, dict] = {}
    for job in get_job_store().list(limit=500):
        if job.result is None:
            continue
        try:
            asset_id = _asset_id(root, Path(job.result.file_path))
        except (OSError, ValueError):
            continue
        metadata.setdefault(
            asset_id,
            {
                "source": getattr(job, "source", "speech"),
                "origin": _origin_for_model(job.result.model),
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
            try:
                asset_id = _asset_id(root, Path(segment.result.file_path))
            except (OSError, ValueError):
                continue
            metadata.setdefault(
                asset_id,
                {
                    "source": "batch_project",
                    "origin": _origin_for_model(segment.result.model),
                    "model": segment.result.model,
                    "text": segment.text,
                    "duration_seconds": segment.result.duration_seconds,
                    "project_id": project.id,
                    "project_title": project.title,
                },
            )
    for job in get_audio_enhancement_store().list():
        for output in job.outputs:
            try:
                asset_id = _asset_id(root, Path(output.file_path))
            except (OSError, ValueError):
                continue
            metadata.setdefault(
                asset_id,
                {
                    "source": "audio_enhancement",
                    "origin": "local",
                    "model": output.model,
                    "text": job.source_file_name,
                    "duration_seconds": output.duration_seconds,
                    "task_id": f"audio-enhancement:{job.id}",
                },
            )
    for job in get_audio_separation_store().list():
        for output in job.outputs:
            try:
                asset_id = _asset_id(root, Path(output.file_path))
            except (OSError, ValueError):
                continue
            metadata.setdefault(
                asset_id,
                {
                    "source": "audio_separation",
                    "origin": "local",
                    "model": job.model_display_name,
                    "text": job.source_file_name,
                    "duration_seconds": output.duration_seconds,
                    "task_id": f"audio-separation:{job.id}",
                },
            )
    return metadata


def _asset_audio_url(asset_id: str) -> str:
    # Preserve the stable legacy URL for top-level output files.  Nested files
    # use the asset endpoint, which applies the same output-root guard.
    if "/" not in asset_id:
        return f"/outputs/{asset_id}"
    return f"/v1/audio-assets/content?asset_id={quote(asset_id, safe='')}"


@router.get("/v1/audio-assets")
def list_audio_assets(limit: int = Query(default=120, ge=1, le=500)) -> dict:
    root = _output_root()
    metadata = _asset_metadata(root)
    candidates: list[tuple[Path, int, float]] = []
    try:
        for path in root.rglob("*"):
            if not path.is_file() or path.suffix.lower() not in SUPPORTED_OUTPUT_SUFFIXES:
                continue
            stat = path.stat()
            candidates.append((path, stat.st_size, stat.st_mtime))
    except OSError:
        candidates = []

    assets: list[AudioAsset] = []
    for path, size, modified_at in sorted(candidates, key=lambda item: item[2], reverse=True)[:limit]:
        try:
            asset_id = _asset_id(root, path)
        except ValueError:
            # A link that resolves outside the monitored root is not a managed
            # asset.  It is deliberately omitted rather than exposed for open
            # or deletion through this API.
            continue
        details = {"origin": "monitored", **metadata.get(asset_id, {})}
        assets.append(
            AudioAsset(
                asset_id=asset_id,
                file_name=path.name,
                file_path=str(path),
                audio_url=_asset_audio_url(asset_id),
                file_size_bytes=size,
                modified_at=datetime.fromtimestamp(modified_at, tz=timezone.utc),
                **details,
            )
        )
    return {"assets": [asset.model_dump(mode="json") for asset in assets]}


@router.get("/v1/audio-assets/content")
def get_audio_asset_content(asset_id: str = Query(min_length=1, max_length=2048)) -> FileResponse:
    path = _resolve_asset_path(asset_id)
    return FileResponse(path, media_type=MEDIA_TYPES.get(path.suffix.lower(), "application/octet-stream"))


@router.delete("/v1/audio-assets")
def delete_audio_asset(asset_id: str = Query(min_length=1, max_length=2048)) -> dict:
    path = _resolve_asset_path(asset_id)
    try:
        path.unlink()
    except OSError as exc:
        raise HTTPException(status_code=500, detail="删除本地音频文件失败") from exc
    return {"deleted": True, "asset_id": asset_id}
