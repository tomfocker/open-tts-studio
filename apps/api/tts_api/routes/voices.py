from uuid import uuid4
import json

from fastapi import APIRouter, HTTPException, status

from tts_api.config import get_settings
from tts_api.schemas import CreateVoiceRequest, UpdateVoiceRequest, VoiceInfo, VoicePackageExport, VoicePackageImportRequest, VoiceQualityReport
from tts_api.voice_library import create_voice_package, import_voice_package, ingest_reference_audio, utc_now
from tts_api.voice_quality import inspect_voice_quality

router = APIRouter()

BUILTIN_VOICES: dict[str, VoiceInfo] = {
    "default": VoiceInfo(
        id="default",
        name="Default",
        authorization_status="built_in",
        source_type="built_in",
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
            {"voices": [voice.model_dump(mode="json") for voice in voices.values()]},
            ensure_ascii=False,
            indent=2,
            sort_keys=True,
        ),
        encoding="utf-8",
    )


def get_custom_voice_or_404(voice_id: str) -> tuple[dict[str, VoiceInfo], VoiceInfo]:
    custom_voices = load_custom_voices()
    voice = custom_voices.get(voice_id)
    if voice is None:
        raise HTTPException(status_code=404, detail="Voice not found.")
    return custom_voices, voice


@router.get("/v1/tts/voices", response_model=list[VoiceInfo])
def list_voices() -> list[VoiceInfo]:
    return list(BUILTIN_VOICES.values()) + list(load_custom_voices().values())


@router.post("/v1/tts/voices", response_model=VoiceInfo)
def create_voice(request: CreateVoiceRequest) -> VoiceInfo:
    settings = get_settings()
    voice_id = uuid4().hex
    reference_asset = (
        ingest_reference_audio(source_path=request.reference_audio, voice_id=voice_id, settings=settings)
        if request.reference_audio
        else {}
    )
    voice = VoiceInfo(
        id=voice_id,
        name=request.name.strip(),
        reference_text=request.reference_text,
        authorization_status=request.authorization_status,
        source_type=request.source_type,
        source_url=request.source_url,
        **reference_asset,
    )
    custom_voices = load_custom_voices()
    custom_voices[voice.id] = voice
    save_custom_voices(custom_voices)
    return voice


@router.patch("/v1/tts/voices/{voice_id}", response_model=VoiceInfo)
def update_voice(voice_id: str, request: UpdateVoiceRequest) -> VoiceInfo:
    custom_voices, voice = get_custom_voice_or_404(voice_id)
    changes = request.model_dump(exclude_unset=True)
    if "name" in changes:
        name = changes["name"]
        if not isinstance(name, str) or not name.strip():
            raise HTTPException(status_code=422, detail="Voice name cannot be empty.")
        changes["name"] = name.strip()
    for text_field in ("reference_text", "source_url"):
        if text_field in changes and isinstance(changes[text_field], str):
            changes[text_field] = changes[text_field].strip() or None
    if "source_type" in changes and isinstance(changes["source_type"], str):
        changes["source_type"] = changes["source_type"].strip() or voice.source_type
    reference_audio = changes.pop("reference_audio", None)
    if reference_audio is not None:
        changes.update(ingest_reference_audio(source_path=reference_audio, voice_id=voice_id, settings=get_settings()))
    changes["updated_at"] = utc_now()
    updated = voice.model_copy(update=changes)
    custom_voices[voice_id] = updated
    save_custom_voices(custom_voices)
    return updated


@router.post("/v1/tts/voices/{voice_id}/export", response_model=VoicePackageExport)
def export_voice_package(voice_id: str) -> VoicePackageExport:
    _, voice = get_custom_voice_or_404(voice_id)
    package = create_voice_package(voice, get_settings())
    return VoicePackageExport(file_name=package.name, export_path=str(package))


@router.post("/v1/tts/voices/import", response_model=VoiceInfo)
def import_voice( request: VoicePackageImportRequest) -> VoiceInfo:
    voice = import_voice_package(package_path=request.package_path, settings=get_settings())
    custom_voices = load_custom_voices()
    custom_voices[voice.id] = voice
    save_custom_voices(custom_voices)
    return voice


@router.get("/v1/tts/voices/{voice_id}/quality", response_model=VoiceQualityReport)
def inspect_voice(voice_id: str) -> VoiceQualityReport:
    if voice_id in BUILTIN_VOICES:
        return inspect_voice_quality(BUILTIN_VOICES[voice_id])
    _, voice = get_custom_voice_or_404(voice_id)
    return inspect_voice_quality(voice)


@router.delete("/v1/tts/voices/{voice_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_voice(voice_id: str) -> None:
    if voice_id in BUILTIN_VOICES:
        raise HTTPException(status_code=400, detail="Built-in voices cannot be deleted.")
    custom_voices, _ = get_custom_voice_or_404(voice_id)
    del custom_voices[voice_id]
    save_custom_voices(custom_voices)
