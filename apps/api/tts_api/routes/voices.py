from uuid import uuid4
import json

from fastapi import APIRouter, HTTPException, status

from tts_api.config import get_settings
from tts_api.schemas import CreateVoiceRequest, VoiceInfo

router = APIRouter()

BUILTIN_VOICES: dict[str, VoiceInfo] = {
    "default": VoiceInfo(
        id="default",
        name="Default",
        authorization_status="built_in",
    )
}


def load_custom_voices() -> dict[str, VoiceInfo]:
    library_file = get_settings().voice_library_file
    if not library_file.exists():
        return {}
    try:
        data = json.loads(library_file.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    raw_voices = data.get("voices", []) if isinstance(data, dict) else []
    custom_voices: dict[str, VoiceInfo] = {}
    for raw_voice in raw_voices:
        try:
            voice = VoiceInfo.model_validate(raw_voice)
        except Exception:
            continue
        if voice.id not in BUILTIN_VOICES:
            custom_voices[voice.id] = voice
    return custom_voices


def save_custom_voices(voices: dict[str, VoiceInfo]) -> None:
    library_file = get_settings().voice_library_file
    library_file.parent.mkdir(parents=True, exist_ok=True)
    library_file.write_text(
        json.dumps(
            {"voices": [voice.model_dump() for voice in voices.values()]},
            ensure_ascii=False,
            indent=2,
            sort_keys=True,
        ),
        encoding="utf-8",
    )


@router.get("/v1/tts/voices", response_model=list[VoiceInfo])
def list_voices() -> list[VoiceInfo]:
    return list(BUILTIN_VOICES.values()) + list(load_custom_voices().values())


@router.post("/v1/tts/voices", response_model=VoiceInfo)
def create_voice(request: CreateVoiceRequest) -> VoiceInfo:
    custom_voices = load_custom_voices()
    voice = VoiceInfo(
        id=uuid4().hex,
        name=request.name,
        reference_audio=request.reference_audio,
        reference_text=request.reference_text,
        authorization_status=request.authorization_status,
    )
    custom_voices[voice.id] = voice
    save_custom_voices(custom_voices)
    return voice


@router.delete("/v1/tts/voices/{voice_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_voice(voice_id: str) -> None:
    if voice_id in BUILTIN_VOICES:
        raise HTTPException(status_code=400, detail="Built-in voices cannot be deleted.")
    custom_voices = load_custom_voices()
    if voice_id not in custom_voices:
        raise HTTPException(status_code=404, detail="Voice not found.")
    del custom_voices[voice_id]
    save_custom_voices(custom_voices)
