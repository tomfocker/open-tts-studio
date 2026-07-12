from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

from tts_api.config import get_settings

router = APIRouter()


@router.get("/outputs/{filename}")
def get_output_audio(filename: str) -> FileResponse:
    if Path(filename).name != filename:
        raise HTTPException(status_code=404, detail="Output file not found")

    output_path = get_settings().output_dir / filename
    if not output_path.exists() or not output_path.is_file():
        raise HTTPException(status_code=404, detail="Output file not found")

    return FileResponse(output_path, media_type="audio/wav")
