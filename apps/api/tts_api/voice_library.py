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

from tts_api.config import Settings
from tts_api.schemas import VoiceInfo


VOICE_PACKAGE_SCHEMA = "open-tts-voice-package"
VOICE_PACKAGE_VERSION = 1
MAX_MANIFEST_BYTES = 1024 * 1024
MAX_AUDIO_BYTES = 200 * 1024 * 1024


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def ingest_reference_audio(
    *,
    source_path: str,
    voice_id: str,
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

    suffix = ".wav" if should_trim else source.suffix.lower() or ".wav"
    destination = settings.voice_asset_dir / voice_id / f"reference{suffix}"
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
        elif source.resolve() != destination.resolve():
            _copy_reference_audio(source, destination)
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


def _copy_reference_audio(source: Path, destination: Path) -> None:
    """Copy atomically so a failed replacement cannot corrupt a saved voice."""
    temporary = destination.with_name(f"{destination.stem}.incoming{destination.suffix}")
    temporary.unlink(missing_ok=True)
    try:
        shutil.copy2(source, temporary)
        temporary.replace(destination)
    finally:
        temporary.unlink(missing_ok=True)


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
    reference_path = Path(voice.reference_audio or "")
    if not reference_path.is_file():
        raise HTTPException(status_code=422, detail="参考音频不存在，无法导出音色包。请先替换参考音频。")
    if reference_path.stat().st_size > MAX_AUDIO_BYTES:
        raise HTTPException(status_code=422, detail="参考音频超过 200 MB，无法导出音色包。")

    suffix = reference_path.suffix.lower() or ".wav"
    package_audio_path = f"audio/reference{suffix}"
    digest = file_sha256(reference_path)
    manifest = {
        "schema": VOICE_PACKAGE_SCHEMA,
        "version": VOICE_PACKAGE_VERSION,
        "voice": {
            "name": voice.name,
            "reference_text": voice.reference_text,
            "authorization_status": voice.authorization_status,
            "source_type": voice.source_type,
            "source_url": voice.source_url,
            "reference_audio": package_audio_path,
            "reference_audio_sha256": digest,
        },
        "exported_at": utc_now().isoformat(),
    }
    safe_name = re.sub(r"[^A-Za-z0-9_-]+", "-", voice.name).strip("-") or "voice"
    destination = settings.voice_export_dir / f"OpenTTS-voice-{safe_name}-{uuid4().hex[:8]}.zip"
    destination.parent.mkdir(parents=True, exist_ok=True)
    try:
        with ZipFile(destination, "w", compression=ZIP_DEFLATED) as archive:
            archive.writestr("voice.json", json.dumps(manifest, ensure_ascii=False, indent=2))
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
            audio_name = voice_data.get("reference_audio")
            if not isinstance(audio_name, str) or not _is_safe_audio_path(audio_name):
                raise ValueError("音色包中的参考音频路径无效。")
            audio_info = archive.getinfo(audio_name)
            if audio_info.is_dir() or audio_info.file_size > MAX_AUDIO_BYTES:
                raise ValueError("参考音频无效或超过 200 MB。")
            voice = _import_manifest_voice(voice_data, audio_info, archive, source, settings)
    except (BadZipFile, KeyError, OSError, ValueError) as exc:
        raise HTTPException(status_code=422, detail=f"无法导入音色包：{exc}") from exc
    return voice


def _read_manifest(archive: ZipFile) -> dict:
    names = archive.namelist()
    if len(names) > 16 or any(not _is_safe_archive_path(name) for name in names):
        raise ValueError("音色包包含不安全的文件路径。")
    manifest_info = archive.getinfo("voice.json")
    if manifest_info.file_size > MAX_MANIFEST_BYTES:
        raise ValueError("voice.json 过大。")
    manifest = json.loads(archive.read(manifest_info).decode("utf-8"))
    if not isinstance(manifest, dict) or manifest.get("schema") != VOICE_PACKAGE_SCHEMA:
        raise ValueError("不是 OpenTTS 音色包。")
    if manifest.get("version") != VOICE_PACKAGE_VERSION:
        raise ValueError("该音色包版本暂不受支持。")
    return manifest


def _import_manifest_voice(voice_data: dict, audio_info, archive: ZipFile, source: Path, settings: Settings) -> VoiceInfo:
    name = voice_data.get("name")
    if not isinstance(name, str) or not name.strip():
        raise ValueError("音色包缺少有效名称。")
    voice_id = uuid4().hex
    suffix = Path(audio_info.filename).suffix.lower() or ".wav"
    destination = settings.voice_asset_dir / voice_id / f"reference{suffix}"
    destination.parent.mkdir(parents=True, exist_ok=True)
    try:
        with archive.open(audio_info) as archive_audio, destination.open("wb") as output:
            shutil.copyfileobj(archive_audio, output, length=1024 * 1024)
    except OSError:
        destination.unlink(missing_ok=True)
        raise
    digest = file_sha256(destination)
    expected_digest = voice_data.get("reference_audio_sha256")
    if isinstance(expected_digest, str) and expected_digest and digest != expected_digest:
        destination.unlink(missing_ok=True)
        raise ValueError("参考音频校验失败，文件可能已损坏。")
    return VoiceInfo(
        id=voice_id,
        name=name.strip()[:120],
        reference_audio=str(destination),
        reference_text=_optional_text(voice_data.get("reference_text")),
        authorization_status=_optional_text(voice_data.get("authorization_status")) or "unknown",
        source_type=_optional_text(voice_data.get("source_type")) or "voice_package",
        source_url=_optional_text(voice_data.get("source_url")),
        original_reference_audio=f"音色包导入：{source.name}",
        reference_audio_sha256=digest,
        reference_audio_managed=True,
    )


def _optional_text(value: object) -> str | None:
    return value.strip() if isinstance(value, str) and value.strip() else None


def _is_safe_archive_path(value: str) -> bool:
    path = PurePosixPath(value)
    return not path.is_absolute() and ".." not in path.parts and "\\" not in value


def _is_safe_audio_path(value: str) -> bool:
    return _is_safe_archive_path(value) and value.startswith("audio/")
