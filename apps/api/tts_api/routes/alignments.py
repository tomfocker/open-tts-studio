from fastapi import APIRouter, HTTPException

from tts_api.alignment import AlignmentError, get_alignment_runner, get_alignment_store
from tts_api.schemas import AlignmentJobInfo


router = APIRouter()


@router.get("/v1/tts/alignments", response_model=list[AlignmentJobInfo])
def list_alignments() -> list[AlignmentJobInfo]:
    """List local post-synthesis alignment tasks without exposing voice data."""

    return get_alignment_store().list()


@router.get("/v1/tts/alignments/{alignment_id}", response_model=AlignmentJobInfo)
def get_alignment(alignment_id: str) -> AlignmentJobInfo:
    job = get_alignment_store().get(alignment_id)
    if job is None:
        raise HTTPException(status_code=404, detail=f"Unknown alignment: {alignment_id}")
    return job


@router.post("/v1/tts/alignments/{alignment_id}/cancel", response_model=AlignmentJobInfo)
def cancel_alignment(alignment_id: str, force: bool = False) -> AlignmentJobInfo:
    try:
        return get_alignment_runner().cancel(alignment_id, force_running=force)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"Unknown alignment: {alignment_id}")
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc))


@router.post("/v1/tts/alignments/{alignment_id}/retry", response_model=AlignmentJobInfo)
def retry_alignment(alignment_id: str) -> AlignmentJobInfo:
    try:
        return get_alignment_runner().retry(alignment_id)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"Unknown alignment: {alignment_id}")
    except (RuntimeError, AlignmentError) as exc:
        raise HTTPException(status_code=409, detail=str(exc))
