from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

from tts_api.config import get_settings

router = APIRouter()


@router.get("/outputs/{filename}")
@router.get("/audio/{filename}")
def get_output_audio(filename: str) -> FileResponse:
    if Path(filename).name != filename:
        raise HTTPException(status_code=404, detail="Output file not found")

    output_path = get_settings().output_dir / filename
    if not output_path.exists() or not output_path.is_file():
        raise HTTPException(status_code=404, detail="Output file not found")

    media_type = "audio/mpeg" if output_path.suffix.lower() == ".mp3" else "audio/wav"
    return FileResponse(output_path, media_type=media_type)


@router.delete("/audio/{filename}")
def delete_legacy_output_audio(filename: str) -> dict:
    if Path(filename).name != filename:
        raise HTTPException(status_code=404, detail="文件不存在")
    output_path = get_settings().output_dir / filename
    if not output_path.is_file():
        raise HTTPException(status_code=404, detail="文件不存在")
    output_path.unlink()
    return {"code": 0, "msg": "删除成功"}
