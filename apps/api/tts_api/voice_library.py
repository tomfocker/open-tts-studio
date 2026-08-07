from __future__ import annotations

import json
import re
import shutil
import subprocess
from datetime import datetime, timezone
from hashlib import sha256
from pathlib import Path, PurePosixPath
from uuid import uuid4
from zipfile import BadZipFile, ZIP_DEFLATED, ZipFile

from fastapi import HTTPException

from tts_api.audio import create_output_path
from tts_api.config import Settings
from tts_api.schemas import VoiceInfo, VoiceReference


VOICE_PACKAGE_SCHEMA = "open-tts-voice-package"
VOICE_PACKAGE_VERSION = 2
MAX_MANIFEST_BYTES = 1024 * 1024
MAX_AUDIO_BYTES = 200 * 1024 * 1024
MAX_REFERENCE_COUNT = 24
MAX_PACKAGE_AUDIO_BYTES = 500 * 1024 * 1024


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def ingest_reference_audio(
    *,
    source_path: str,
    voice_id: str,
    reference_id: str | None = None,
    settings: Settings,
    trim_start_seconds: float | None = None,
    trim_end_seconds: float | None = None,
) -> dict[str, str | bool | None]:
    source = Path(source_path).expanduser()
    original_path = str(source)
    should_trim = trim_start_seconds is not None or trim_end_seconds is not None
    if should_trim and (trim_start_seconds is None or trim_end_seconds is None or trim_end_seconds <= trim_start_seconds):
        raise HTTPException(status_code=422, detail="裁切范围无效，请重新选择起点和终点。")
    if not source.is_file():
        if should_trim:
            raise HTTPException(status_code=404, detail="未找到需要裁切的参考音频。")
        return {
            "reference_audio": original_path,
            "original_reference_audio": original_path,
            "reference_audio_sha256": None,
            "reference_audio_managed": False,
        }

    # A managed library asset should be boring on purpose: mono PCM16 WAV is
    # readable by Python's stdlib, FFmpeg and all current adapter packages.
    # The original source remains recorded in ``original_reference_audio``.
    safe_reference_id = re.sub(r"[^A-Za-z0-9_-]+", "-", reference_id or "reference").strip("-") or "reference"
    destination = settings.voice_asset_dir / voice_id / f"{safe_reference_id}.wav"
    destination.parent.mkdir(parents=True, exist_ok=True)
    try:
        if should_trim:
            _trim_reference_audio(
                source=source,
                destination=destination,
                ffmpeg_path=settings.ffmpeg_path,
                start_seconds=trim_start_seconds,
                end_seconds=trim_end_seconds,
            )
        else:
            _store_compatible_reference_audio(
                source=source,
                destination=destination,
                ffmpeg_path=settings.ffmpeg_path,
            )
        return {
            "reference_audio": str(destination),
            "original_reference_audio": original_path,
            "reference_audio_sha256": file_sha256(destination),
            "reference_audio_managed": True,
        }
    except OSError:
        return {
            "reference_audio": original_path,
            "original_reference_audio": original_path,
            "reference_audio_sha256": None,
            "reference_audio_managed": False,
        }


def repair_managed_reference_audio(*, reference_path: str, settings: Settings) -> bool:
    """Convert an older managed asset in place when it is not PCM16 WAV.

    Returns ``True`` only when a conversion was necessary. The original
    generation/source path is deliberately not touched.
    """
    source = Path(reference_path)
    if not source.is_file():
        raise HTTPException(status_code=404, detail="参考音频文件不存在，无法修复。")
    if _is_compatible_pcm16_wav(source):
        return False
    _transcode_reference_audio(source=source, destination=source, ffmpeg_path=settings.ffmpeg_path)
    return True


def _copy_reference_audio(source: Path, destination: Path) -> None:
    """Copy atomically so a failed replacement cannot corrupt a saved voice."""
    temporary = destination.with_name(f"{destination.stem}.incoming{destination.suffix}")
    temporary.unlink(missing_ok=True)
    try:
        shutil.copy2(source, temporary)
        temporary.replace(destination)
    finally:
        temporary.unlink(missing_ok=True)


def _is_compatible_pcm16_wav(path: Path) -> bool:
    if path.suffix.lower() != ".wav":
        return False
    try:
        import wave

        with wave.open(str(path), "rb") as wav_file:
            return wav_file.getcomptype() == "NONE" and wav_file.getsampwidth() == 2 and wav_file.getnchannels() == 1
    except (OSError, wave.Error):
        return False


def _store_compatible_reference_audio(*, source: Path, destination: Path, ffmpeg_path: str) -> None:
    if _is_compatible_pcm16_wav(source):
        if source.resolve() != destination.resolve():
            _copy_reference_audio(source, destination)
        return
    _transcode_reference_audio(source=source, destination=destination, ffmpeg_path=ffmpeg_path)


def _trim_reference_audio(*, source: Path, destination: Path, ffmpeg_path: str, start_seconds: float, end_seconds: float) -> None:
    """Decode the selected portion to WAV before replacing the managed asset."""
    temporary = destination.with_name(f"{destination.stem}.incoming.wav")
    temporary.unlink(missing_ok=True)
    duration_seconds = end_seconds - start_seconds
    command = [
        ffmpeg_path,
        "-hide_banner",
        "-loglevel",
        "error",
        "-nostdin",
        "-y",
        "-i",
        str(source),
        "-ss",
        f"{start_seconds:.3f}",
        "-t",
        f"{duration_seconds:.3f}",
        "-map",
        "0:a:0",
        "-vn",
        "-ac",
        "1",
        "-c:a",
        "pcm_s16le",
        str(temporary),
    ]
    try:
        subprocess.run(command, check=True, capture_output=True, timeout=60)
        if not temporary.is_file() or temporary.stat().st_size <= 44:
            raise RuntimeError("裁切结果为空")
        temporary.replace(destination)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=503, detail="找不到 FFmpeg，无法裁切参考音频。") from exc
    except subprocess.TimeoutExpired as exc:
        raise HTTPException(status_code=504, detail="裁切参考音频超时，请缩短片段后重试。") from exc
    except (subprocess.CalledProcessError, RuntimeError) as exc:
        raise HTTPException(status_code=422, detail="无法裁切该参考音频，请检查文件是否可正常播放。") from exc
    finally:
        temporary.unlink(missing_ok=True)


def _transcode_reference_audio(*, source: Path, destination: Path, ffmpeg_path: str) -> None:
    """Atomically decode a reference audio file to mono PCM16 WAV."""
    temporary = destination.with_name(f"{destination.stem}.incoming.wav")
    temporary.unlink(missing_ok=True)
    command = [
        ffmpeg_path,
        "-hide_banner",
        "-loglevel",
        "error",
        "-nostdin",
        "-y",
        "-i",
        str(source),
        "-map",
        "0:a:0",
        "-vn",
        "-ac",
        "1",
        "-c:a",
        "pcm_s16le",
        str(temporary),
    ]
    try:
        subprocess.run(command, check=True, capture_output=True, timeout=60)
        if not temporary.is_file() or temporary.stat().st_size <= 44:
            raise RuntimeError("转码结果为空")
        temporary.replace(destination)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=503, detail="找不到 FFmpeg，无法转换参考音频。") from exc
    except subprocess.TimeoutExpired as exc:
        raise HTTPException(status_code=504, detail="转换参考音频超时，请缩短片段后重试。") from exc
    except (subprocess.CalledProcessError, RuntimeError) as exc:
        raise HTTPException(status_code=422, detail="无法转换该参考音频，请检查文件是否可正常播放。") from exc
    finally:
        temporary.unlink(missing_ok=True)


def file_sha256(path: Path) -> str:
    digest = sha256()
    with path.open("rb") as audio_file:
        for chunk in iter(lambda: audio_file.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def find_stored_voice(voice_id: str, settings: Settings) -> VoiceInfo | None:
    """Find a user-managed voice without importing the HTTP route layer."""
    library_file = settings.voice_library_file
    if not library_file.exists():
        return None
    try:
        data = json.loads(library_file.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    raw_voices = data.get("voices", []) if isinstance(data, dict) else []
    for raw_voice in raw_voices:
        try:
            voice = VoiceInfo.model_validate(raw_voice)
        except Exception:
            continue
        if voice.id == voice_id:
            return voice
    return None


def create_voice_package(voice: VoiceInfo, settings: Settings) -> Path:
    if voice.model_binding is not None:
        raise HTTPException(
            status_code=422,
            detail="模型专属权重不能导出为普通音色包；请在目标电脑单独安装对应模型权重。",
        )
    if not voice.references:
        raise HTTPException(status_code=422, detail="角色没有参考音频，无法导出音色包。")
    if len(voice.references) > MAX_REFERENCE_COUNT:
        raise HTTPException(status_code=422, detail=f"音色包最多支持 {MAX_REFERENCE_COUNT} 条参考片段。")

    package_references: list[dict[str, object]] = []
    packaged_assets: list[tuple[Path, str]] = []
    total_size = 0
    for index, reference in enumerate(voice.references, start=1):
        reference_path = Path(reference.reference_audio or "")
        if not reference_path.is_file():
            raise HTTPException(status_code=422, detail=f"参考片段「{reference.name}」不存在，无法导出。")
        file_size = reference_path.stat().st_size
        if file_size > MAX_AUDIO_BYTES:
            raise HTTPException(status_code=422, detail=f"参考片段「{reference.name}」超过 200 MB，无法导出。")
        total_size += file_size
        if total_size > MAX_PACKAGE_AUDIO_BYTES:
            raise HTTPException(status_code=422, detail="所有参考片段合计超过 500 MB，无法导出音色包。")
        safe_id = re.sub(r"[^A-Za-z0-9_-]+", "-", reference.id).strip("-") or f"reference-{index}"
        suffix = reference_path.suffix.lower() or ".wav"
        package_audio_path = f"audio/{safe_id}{suffix}"
        package_references.append(
            {
                "id": reference.id,
                "name": reference.name,
                "reference_text": reference.reference_text,
                "source_type": reference.source_type,
                "source_url": reference.source_url,
                "reference_audio": package_audio_path,
                "reference_audio_sha256": file_sha256(reference_path),
            }
        )
        packaged_assets.append((reference_path, package_audio_path))

    manifest = {
        "schema": VOICE_PACKAGE_SCHEMA,
        "version": VOICE_PACKAGE_VERSION,
        "voice": {
            "name": voice.name,
            "authorization_status": voice.authorization_status,
            "source_type": voice.source_type,
            "source_url": voice.source_url,
            "active_reference_id": voice.active_reference_id,
            "references": package_references,
        },
        "exported_at": utc_now().isoformat(),
    }
    destination = create_output_path(settings.voice_export_dir, ".zip", voice.name)
    destination.parent.mkdir(parents=True, exist_ok=True)
    try:
        with ZipFile(destination, "w", compression=ZIP_DEFLATED) as archive:
            archive.writestr("voice.json", json.dumps(manifest, ensure_ascii=False, indent=2))
            for reference_path, package_audio_path in packaged_assets:
                archive.write(reference_path, package_audio_path)
    except OSError as exc:
        raise HTTPException(status_code=500, detail=f"无法写入音色包：{exc}") from exc
    return destination


def import_voice_package(*, package_path: str, settings: Settings) -> VoiceInfo:
    source = Path(package_path).expanduser()
    if not source.is_file():
        raise HTTPException(status_code=404, detail="未找到音色包文件。")
    try:
        with ZipFile(source) as archive:
            manifest = _read_manifest(archive)
            voice_data = manifest.get("voice")
            if not isinstance(voice_data, dict):
                raise ValueError("voice.json 缺少 voice 对象。")
            voice = _import_manifest_voice(
                voice_data,
                archive,
                source,
                settings,
                version=int(manifest.get("version", 0)),
            )
    except (BadZipFile, KeyError, OSError, ValueError) as exc:
        raise HTTPException(status_code=422, detail=f"无法导入音色包：{exc}") from exc
    return voice


def _read_manifest(archive: ZipFile) -> dict:
    names = archive.namelist()
    if len(names) > MAX_REFERENCE_COUNT + 2 or any(not _is_safe_archive_path(name) for name in names):
        raise ValueError("音色包包含不安全的文件路径。")
    manifest_info = archive.getinfo("voice.json")
    if manifest_info.file_size > MAX_MANIFEST_BYTES:
        raise ValueError("voice.json 过大。")
    manifest = json.loads(archive.read(manifest_info).decode("utf-8"))
    if not isinstance(manifest, dict) or manifest.get("schema") != VOICE_PACKAGE_SCHEMA:
        raise ValueError("不是 OpenTTS 音色包。")
    if manifest.get("version") not in {1, VOICE_PACKAGE_VERSION}:
        raise ValueError("该音色包版本暂不受支持。")
    return manifest


def _import_manifest_voice(voice_data: dict, archive: ZipFile, source: Path, settings: Settings, *, version: int) -> VoiceInfo:
    name = voice_data.get("name")
    if not isinstance(name, str) or not name.strip():
        raise ValueError("音色包缺少有效名称。")
    voice_id = uuid4().hex
    raw_references = _read_package_references(voice_data, version)
    if not raw_references or len(raw_references) > MAX_REFERENCE_COUNT:
        raise ValueError(f"音色包需要 1～{MAX_REFERENCE_COUNT} 条参考片段。")

    total_size = 0
    references: list[VoiceReference] = []
    imported_id_by_package_id: dict[str, str] = {}
    for index, raw_reference in enumerate(raw_references, start=1):
        if not isinstance(raw_reference, dict):
            raise ValueError("音色包中的参考片段格式无效。")
        audio_name = raw_reference.get("reference_audio")
        if not isinstance(audio_name, str) or not _is_safe_audio_path(audio_name):
            raise ValueError("音色包中的参考音频路径无效。")
        audio_info = archive.getinfo(audio_name)
        if audio_info.is_dir() or audio_info.file_size > MAX_AUDIO_BYTES:
            raise ValueError("参考音频无效或超过 200 MB。")
        total_size += audio_info.file_size
        if total_size > MAX_PACKAGE_AUDIO_BYTES:
            raise ValueError("音色包中的参考音频合计超过 500 MB。")
        package_reference_id = raw_reference.get("id")
        if not isinstance(package_reference_id, str) or not package_reference_id:
            package_reference_id = f"reference-{index}"
        reference_id = uuid4().hex
        if package_reference_id in imported_id_by_package_id:
            raise ValueError("音色包中的参考片段 ID 重复。")
        imported_id_by_package_id[package_reference_id] = reference_id
        references.append(
            _import_manifest_reference(
                raw_reference,
                audio_info,
                archive,
                source,
                settings,
                voice_id=voice_id,
                reference_id=reference_id,
                fallback_name=f"参考片段 {index}",
            )
        )

    package_active_reference_id = voice_data.get("active_reference_id")
    active_reference_id = imported_id_by_package_id.get(package_active_reference_id) if isinstance(package_active_reference_id, str) else None
    return VoiceInfo(
        id=voice_id,
        name=name.strip()[:120],
        authorization_status=_optional_text(voice_data.get("authorization_status")) or "unknown",
        source_type=_optional_text(voice_data.get("source_type")) or "voice_package",
        source_url=_optional_text(voice_data.get("source_url")),
        references=references,
        active_reference_id=active_reference_id or references[0].id,
    )


def _read_package_references(voice_data: dict, version: int) -> list[dict]:
    if version == 1:
        return [
            {
                "id": "legacy-main",
                "name": "主参考",
                "reference_text": voice_data.get("reference_text"),
                "source_type": voice_data.get("source_type"),
                "source_url": voice_data.get("source_url"),
                "reference_audio": voice_data.get("reference_audio"),
                "reference_audio_sha256": voice_data.get("reference_audio_sha256"),
            }
        ]
    references = voice_data.get("references")
    return references if isinstance(references, list) else []


def _import_manifest_reference(
    raw_reference: dict,
    audio_info,
    archive: ZipFile,
    source: Path,
    settings: Settings,
    *,
    voice_id: str,
    reference_id: str,
    fallback_name: str,
) -> VoiceReference:
    suffix = Path(audio_info.filename).suffix.lower() or ".wav"
    imported_destination = settings.voice_asset_dir / voice_id / f"{reference_id}.imported{suffix}"
    destination = settings.voice_asset_dir / voice_id / f"{reference_id}.wav"
    imported_destination.parent.mkdir(parents=True, exist_ok=True)
    try:
        with archive.open(audio_info) as archive_audio, imported_destination.open("wb") as output:
            shutil.copyfileobj(archive_audio, output, length=1024 * 1024)
        imported_digest = file_sha256(imported_destination)
        expected_digest = raw_reference.get("reference_audio_sha256")
        if isinstance(expected_digest, str) and expected_digest and imported_digest != expected_digest:
            raise ValueError("参考音频校验失败，文件可能已损坏。")
        _store_compatible_reference_audio(
            source=imported_destination,
            destination=destination,
            ffmpeg_path=settings.ffmpeg_path,
        )
    except OSError:
        destination.unlink(missing_ok=True)
        raise
    finally:
        imported_destination.unlink(missing_ok=True)

    reference_name = raw_reference.get("name")
    return VoiceReference(
        id=reference_id,
        name=reference_name.strip()[:120] if isinstance(reference_name, str) and reference_name.strip() else fallback_name,
        reference_audio=str(destination),
        reference_text=_optional_text(raw_reference.get("reference_text")),
        source_type=_optional_text(raw_reference.get("source_type")) or "voice_package",
        source_url=_optional_text(raw_reference.get("source_url")),
        original_reference_audio=f"音色包导入：{source.name}",
        reference_audio_sha256=file_sha256(destination),
        reference_audio_managed=True,
    )


def _optional_text(value: object) -> str | None:
    return value.strip() if isinstance(value, str) and value.strip() else None


def _is_safe_archive_path(value: str) -> bool:
    path = PurePosixPath(value)
    return not path.is_absolute() and ".." not in path.parts and "\\" not in value


def _is_safe_audio_path(value: str) -> bool:
    return _is_safe_archive_path(value) and value.startswith("audio/")
