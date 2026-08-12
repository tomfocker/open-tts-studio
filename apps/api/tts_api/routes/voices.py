from uuid import uuid4
import json
from pathlib import Path

from fastapi import APIRouter, HTTPException, status

from tts_api.adapters.asr import get_local_transcriber
from tts_api.config import get_settings
from tts_api.runtime_memory import local_gpu_generation_lock, release_conflicting_runtimes, resolve_runtime_settings
from tts_api.schemas import (
    CreateVoiceReferenceRequest,
    CreateVoiceRequest,
    UpdateVoiceReferenceRequest,
    UpdateVoiceRequest,
    VoiceAudioRepair,
    VoiceInfo,
    VoicePackageExport,
    VoicePackageImportRequest,
    VoiceQualityReport,
    VoiceReference,
)
from tts_api.voice_library import create_voice_package, file_sha256, import_voice_package, ingest_reference_audio, repair_managed_reference_audio, utc_now
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
    migrated_legacy_voice = False
    for raw_voice in raw_voices:
        try:
            voice = VoiceInfo.model_validate(raw_voice)
        except Exception:
            continue
        if voice.id not in BUILTIN_VOICES:
            custom_voices[voice.id] = voice
            migrated_legacy_voice = migrated_legacy_voice or (
                isinstance(raw_voice, dict)
                and bool(raw_voice.get("reference_audio"))
                and "references" not in raw_voice
            )
    if migrated_legacy_voice:
        save_custom_voices(custom_voices)
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


def rebuild_voice(voice: VoiceInfo, **changes: object) -> VoiceInfo:
    """Re-validate a role after changing clips so legacy fields stay in sync."""
    payload = voice.model_dump(mode="python")
    payload.update(changes)
    return VoiceInfo.model_validate(payload)


def get_reference_or_404(voice: VoiceInfo, reference_id: str) -> VoiceReference:
    reference = next((item for item in voice.references if item.id == reference_id), None)
    if reference is None:
        raise HTTPException(status_code=404, detail="Reference clip not found.")
    return reference


def active_reference_or_404(voice: VoiceInfo) -> VoiceReference:
    if not voice.active_reference_id:
        raise HTTPException(status_code=422, detail="该角色没有可用的参考音频。")
    return get_reference_or_404(voice, voice.active_reference_id)


def replace_reference(voice: VoiceInfo, replacement: VoiceReference) -> VoiceInfo:
    return rebuild_voice(
        voice,
        references=[replacement if item.id == replacement.id else item for item in voice.references],
        updated_at=utc_now(),
    )


@router.get("/v1/tts/voices", response_model=list[VoiceInfo])
def list_voices() -> list[VoiceInfo]:
    return list(BUILTIN_VOICES.values()) + list(load_custom_voices().values())


@router.post("/v1/tts/voices", response_model=VoiceInfo)
def create_voice(request: CreateVoiceRequest) -> VoiceInfo:
    settings = get_settings()
    voice_id = uuid4().hex
    trim_start_seconds, trim_end_seconds = _resolve_trim_range(
        request.trim_start_seconds,
        request.trim_end_seconds,
    )
    if (trim_start_seconds is not None or trim_end_seconds is not None) and not request.reference_audio:
        raise HTTPException(status_code=422, detail="裁切参数需要和参考音频一起提交。")
    reference_id = uuid4().hex if request.reference_audio else None
    reference_asset = (
        ingest_reference_audio(
            source_path=request.reference_audio,
            voice_id=voice_id,
            reference_id=reference_id,
            settings=settings,
            trim_start_seconds=trim_start_seconds,
            trim_end_seconds=trim_end_seconds,
        )
        if request.reference_audio
        else {}
    )
    references = (
        [
            VoiceReference(
                id=reference_id or uuid4().hex,
                name=(request.reference_name or "主参考").strip() or "主参考",
                reference_text=request.reference_text,
                source_type=request.source_type,
                source_url=request.source_url,
                **reference_asset,
            )
        ]
        if reference_asset
        else []
    )
    voice = VoiceInfo(
        id=voice_id,
        name=request.name.strip(),
        authorization_status=request.authorization_status,
        source_type=request.source_type,
        source_url=request.source_url,
        model_binding=request.model_binding,
        references=references,
        active_reference_id=references[0].id if references else None,
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
    reference_text = changes.pop("reference_text", None) if "reference_text" in changes else None
    has_reference_text_change = "reference_text" in request.model_fields_set
    trim_start_seconds = changes.pop("trim_start_seconds", None)
    trim_end_seconds = changes.pop("trim_end_seconds", None)
    if reference_audio is not None or has_reference_text_change or trim_start_seconds is not None or trim_end_seconds is not None:
        reference = active_reference_or_404(voice)
        reference_changes: dict[str, object] = {"updated_at": utc_now()}
        if has_reference_text_change:
            reference_changes["reference_text"] = reference_text
        if reference_audio is not None:
            trim_start_seconds, trim_end_seconds = _resolve_trim_range(trim_start_seconds, trim_end_seconds)
            reference_changes.update(
                ingest_reference_audio(
                    source_path=reference_audio,
                    voice_id=voice_id,
                    reference_id=reference.id,
                    settings=get_settings(),
                    trim_start_seconds=trim_start_seconds,
                    trim_end_seconds=trim_end_seconds,
                )
            )
        elif trim_start_seconds is not None or trim_end_seconds is not None:
            raise HTTPException(status_code=422, detail="裁切参数需要和参考音频一起提交。")
        reference = reference.model_copy(update=reference_changes)
        changes["references"] = [reference if item.id == reference.id else item for item in voice.references]
    changes["updated_at"] = utc_now()
    updated = rebuild_voice(voice, **changes)
    custom_voices[voice_id] = updated
    save_custom_voices(custom_voices)
    return updated


@router.post("/v1/tts/voices/{voice_id}/references", response_model=VoiceInfo)
def create_voice_reference(voice_id: str, request: CreateVoiceReferenceRequest) -> VoiceInfo:
    custom_voices, voice = get_custom_voice_or_404(voice_id)
    if voice.model_binding is not None:
        raise HTTPException(status_code=422, detail="模型专属权重角色不能添加普通参考音频。")
    if len(voice.references) >= 24:
        raise HTTPException(status_code=422, detail="一个角色最多保留 24 条参考片段。")
    trim_start_seconds, trim_end_seconds = _resolve_trim_range(
        request.trim_start_seconds,
        request.trim_end_seconds,
    )
    reference_id = uuid4().hex
    reference = VoiceReference(
        id=reference_id,
        name=request.name.strip(),
        reference_text=request.reference_text.strip() if isinstance(request.reference_text, str) and request.reference_text.strip() else None,
        source_type=request.source_type.strip() or "local_import",
        source_url=request.source_url.strip() if isinstance(request.source_url, str) and request.source_url.strip() else None,
        **ingest_reference_audio(
            source_path=request.reference_audio,
            voice_id=voice_id,
            reference_id=reference_id,
            settings=get_settings(),
            trim_start_seconds=trim_start_seconds,
            trim_end_seconds=trim_end_seconds,
        ),
    )
    updated = rebuild_voice(voice, references=[*voice.references, reference], updated_at=utc_now())
    custom_voices[voice_id] = updated
    save_custom_voices(custom_voices)
    return updated


@router.patch("/v1/tts/voices/{voice_id}/references/{reference_id}", response_model=VoiceInfo)
def update_voice_reference(voice_id: str, reference_id: str, request: UpdateVoiceReferenceRequest) -> VoiceInfo:
    custom_voices, voice = get_custom_voice_or_404(voice_id)
    reference = get_reference_or_404(voice, reference_id)
    changes = request.model_dump(exclude_unset=True)
    if "name" in changes:
        name = changes["name"]
        if not isinstance(name, str) or not name.strip():
            raise HTTPException(status_code=422, detail="参考片段名称不能为空。")
        changes["name"] = name.strip()
    for text_field in ("reference_text", "source_url"):
        if text_field in changes and isinstance(changes[text_field], str):
            changes[text_field] = changes[text_field].strip() or None
    if "source_type" in changes and isinstance(changes["source_type"], str):
        changes["source_type"] = changes["source_type"].strip() or reference.source_type

    reference_audio = changes.pop("reference_audio", None)
    trim_start_seconds = changes.pop("trim_start_seconds", None)
    trim_end_seconds = changes.pop("trim_end_seconds", None)
    if reference_audio is not None:
        trim_start_seconds, trim_end_seconds = _resolve_trim_range(trim_start_seconds, trim_end_seconds)
        changes.update(
            ingest_reference_audio(
                source_path=reference_audio,
                voice_id=voice_id,
                reference_id=reference_id,
                settings=get_settings(),
                trim_start_seconds=trim_start_seconds,
                trim_end_seconds=trim_end_seconds,
            )
        )
    elif trim_start_seconds is not None or trim_end_seconds is not None:
        raise HTTPException(status_code=422, detail="裁切参数需要和参考音频一起提交。")

    updated_reference = reference.model_copy(update={**changes, "updated_at": utc_now()})
    updated = replace_reference(voice, updated_reference)
    custom_voices[voice_id] = updated
    save_custom_voices(custom_voices)
    return updated


@router.post("/v1/tts/voices/{voice_id}/references/{reference_id}/activate", response_model=VoiceInfo)
def activate_voice_reference(voice_id: str, reference_id: str) -> VoiceInfo:
    custom_voices, voice = get_custom_voice_or_404(voice_id)
    get_reference_or_404(voice, reference_id)
    updated = rebuild_voice(voice, active_reference_id=reference_id, updated_at=utc_now())
    custom_voices[voice_id] = updated
    save_custom_voices(custom_voices)
    return updated


@router.delete("/v1/tts/voices/{voice_id}/references/{reference_id}", response_model=VoiceInfo)
def delete_voice_reference(voice_id: str, reference_id: str) -> VoiceInfo:
    custom_voices, voice = get_custom_voice_or_404(voice_id)
    reference = get_reference_or_404(voice, reference_id)
    if len(voice.references) <= 1:
        raise HTTPException(status_code=422, detail="角色至少要保留一条参考片段；如需删除角色，请删除整个档案。")
    remaining = [item for item in voice.references if item.id != reference_id]
    next_active_reference_id = voice.active_reference_id if voice.active_reference_id != reference_id else remaining[0].id
    updated = rebuild_voice(
        voice,
        references=remaining,
        active_reference_id=next_active_reference_id,
        updated_at=utc_now(),
    )
    custom_voices[voice_id] = updated
    save_custom_voices(custom_voices)
    _delete_managed_reference_asset(reference, get_settings())
    return updated


def _resolve_trim_range(start_seconds: float | None, end_seconds: float | None) -> tuple[float | None, float | None]:
    """Keep trimming opt-in and reject partial/invalid client ranges early."""
    if start_seconds is None and end_seconds is None:
        return None, None
    if start_seconds is None or end_seconds is None:
        raise HTTPException(status_code=422, detail="裁切时请同时提供起点和终点。")
    if end_seconds <= start_seconds:
        raise HTTPException(status_code=422, detail="裁切终点必须晚于起点。")
    return start_seconds, end_seconds


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


@router.post("/v1/tts/voices/{voice_id}/repair-audio", response_model=VoiceAudioRepair)
def repair_voice_audio(voice_id: str) -> VoiceAudioRepair:
    """Normalize legacy/generated references that were saved as float WAV files."""
    custom_voices, voice = get_custom_voice_or_404(voice_id)
    reference = active_reference_or_404(voice)
    if not reference.reference_audio:
        raise HTTPException(status_code=422, detail="该角色没有可修复的参考音频。")
    if not reference.reference_audio_managed:
        raise HTTPException(status_code=422, detail="只能修复音色库托管的音频；请先替换或重新导入该参考音频。")

    converted = repair_managed_reference_audio(reference_path=reference.reference_audio, settings=get_settings())
    updated_reference = reference.model_copy(
        update={
            "reference_audio_sha256": file_sha256(Path(reference.reference_audio)),
            "updated_at": utc_now(),
        }
    )
    updated = replace_reference(voice, updated_reference)
    custom_voices[voice_id] = updated
    save_custom_voices(custom_voices)
    return VoiceAudioRepair(voice=updated, converted=converted)


def recognize_reference_audio(reference: VoiceReference) -> str:
    if not reference.reference_audio:
        raise HTTPException(status_code=422, detail="该参考片段没有可识别的音频。")
    try:
        settings = resolve_runtime_settings(get_settings())
        # Reference clips use the configured independent ASR backend. Keep
        # this lifecycle separate from Vox/TTS so changing the TTS package
        # cannot remove reference transcription.
        with local_gpu_generation_lock:
            transcriber = get_local_transcriber(settings)
            # Short reference transcription fits beside ordinary VoxCPM2 on
            # supported GPUs. Keep both resident while the shared generation
            # lock guarantees that ASR and TTS never execute concurrently.
            release_conflicting_runtimes(
                transcriber.runtime_model_id,
                settings,
                preserve_model_ids=frozenset({"voxcpm2"}),
            )
            return transcriber.transcribe_path(Path(reference.reference_audio), language="zh")
    except FileNotFoundError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=f"参考音频识别失败：{exc}") from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"无法启动本地 ASR 参考音频识别：{exc}") from exc


@router.post("/v1/tts/voices/{voice_id}/references/{reference_id}/recognize")
def recognize_voice_reference_clip(voice_id: str, reference_id: str) -> dict[str, str]:
    _, voice = get_custom_voice_or_404(voice_id)
    reference = get_reference_or_404(voice, reference_id)
    return {"voice_id": voice_id, "reference_id": reference_id, "text": recognize_reference_audio(reference)}


@router.post("/v1/tts/voices/{voice_id}/recognize")
def recognize_voice_reference(voice_id: str) -> dict[str, str]:
    """Fill a saved voice's transcript from its managed reference audio.

    The client deliberately decides whether to save the returned text so users
    can correct recognition errors before it becomes an extreme-clone prompt.
    """
    _, voice = get_custom_voice_or_404(voice_id)
    return {"voice_id": voice_id, "text": recognize_reference_audio(active_reference_or_404(voice))}


@router.delete("/v1/tts/voices/{voice_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_voice(voice_id: str) -> None:
    if voice_id in BUILTIN_VOICES:
        raise HTTPException(status_code=400, detail="Built-in voices cannot be deleted.")
    custom_voices, _ = get_custom_voice_or_404(voice_id)
    del custom_voices[voice_id]
    save_custom_voices(custom_voices)


def _delete_managed_reference_asset(reference: VoiceReference, settings) -> None:
    """Delete a removed clip only when it is inside the managed role folder."""
    if not reference.reference_audio_managed or not reference.reference_audio:
        return
    try:
        path = Path(reference.reference_audio).resolve()
        root = settings.voice_asset_dir.resolve()
        if root not in path.parents:
            return
        path.unlink(missing_ok=True)
        parent = path.parent
        if parent != root and not any(parent.iterdir()):
            parent.rmdir()
    except OSError:
        # Metadata deletion must not fail because an antivirus or audio player
        # still holds the old WAV open on Windows.
        return
