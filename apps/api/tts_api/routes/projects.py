from fastapi import APIRouter, HTTPException

from tts_api.projects import get_project_runner, get_project_store
from tts_api.schemas import BatchProject, BatchProjectCreate, BatchProjectUpdate

router = APIRouter()


def _get_project_or_404(project_id: str) -> BatchProject:
    project = get_project_store().get(project_id)
    if project is None:
        raise HTTPException(status_code=404, detail=f"Unknown project: {project_id}")
    return project


@router.get("/v1/projects", response_model=list[BatchProject])
def list_projects() -> list[BatchProject]:
    return get_project_store().list()


@router.post("/v1/projects", response_model=BatchProject)
def create_project(payload: BatchProjectCreate) -> BatchProject:
    if not any(segment.text.strip() for segment in payload.segments):
        raise HTTPException(status_code=422, detail="项目至少需要一个非空片段。")
    project = get_project_store().create(payload)
    return project


@router.get("/v1/projects/{project_id}", response_model=BatchProject)
def get_project(project_id: str) -> BatchProject:
    return _get_project_or_404(project_id)


@router.patch("/v1/projects/{project_id}", response_model=BatchProject)
def update_project(project_id: str, payload: BatchProjectUpdate) -> BatchProject:
    if payload.segments is not None and not any(segment.text.strip() for segment in payload.segments):
        raise HTTPException(status_code=422, detail="项目至少需要一个非空片段。")
    try:
        return get_project_store().update(project_id, payload)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"Unknown project: {project_id}")
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc))


@router.post("/v1/projects/{project_id}/run", response_model=BatchProject)
def run_project(project_id: str) -> BatchProject:
    try:
        return get_project_runner().enqueue(project_id)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"Unknown project: {project_id}")
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc))


@router.post("/v1/projects/{project_id}/retry", response_model=BatchProject)
def retry_project(project_id: str) -> BatchProject:
    store = get_project_store()
    try:
        store.reset_failed(project_id)
        return get_project_runner().enqueue(project_id)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"Unknown project: {project_id}")
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc))


@router.get("/v1/projects/{project_id}/export")
def export_project_manifest(project_id: str) -> dict:
    project = _get_project_or_404(project_id)
    return {
        "project_id": project.id,
        "title": project.title,
        "status": project.status,
        "items": [
            {
                "position": segment.position,
                "text": segment.text,
                "status": segment.status,
                "audio_url": segment.result.audio_url if segment.result else None,
                "file_path": segment.result.file_path if segment.result else None,
                "error": segment.error,
            }
            for segment in project.segments
        ],
    }
