from __future__ import annotations

import os
import subprocess
from pathlib import Path

from tts_api.adapters.base import TtsAdapter
from tts_api.audio import create_output_path, read_wav_metadata
from tts_api.config import Settings, get_settings
from tts_api.doubao_cookies import DoubaoCookiePool
from tts_api.doubao_legacy_config import DoubaoDeviceIdStore, DoubaoLegacyConfig
from tts_api.doubao_protocol import (
    DoubaoBlockedError,
    DoubaoProtocolError,
    DoubaoRateLimitError,
    DoubaoWebSocketClient,
)
from tts_api.doubao_throttle import DoubaoRequestThrottler, get_doubao_request_throttler
from tts_api.schemas import SpeechRequest, SpeechResult


DEFAULT_DOUBAO_VOICE = "zh_female_wenroutaozi_uranus_bigtts"


def speed_to_speech_rate(speed: float) -> int:
    return max(-50, min(100, round((speed - 1.0) * 50)))


class FfmpegAudioConverter:
    def __init__(self, ffmpeg_path: str = "ffmpeg"):
        self.ffmpeg_path = ffmpeg_path

    def convert(self, audio: bytes, output_path: Path, output_format: str) -> None:
        format_name = output_format.lower()
        if format_name not in {"wav", "mp3"}:
            raise ValueError(f"Unsupported Doubao output format: {output_format}")
        command = [
            self.ffmpeg_path,
            "-hide_banner",
            "-loglevel",
            "error",
            "-f",
            "aac",
            "-i",
            "pipe:0",
            "-ar",
            "24000",
            "-ac",
            "1",
        ]
        if format_name == "mp3":
            command.extend(["-codec:a", "libmp3lame", "-b:a", "64k"])
        command.extend(["-y", str(output_path)])
        try:
            subprocess.run(
                command,
                input=audio,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                check=True,
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0) if os.name == "nt" else 0,
            )
        except FileNotFoundError as exc:
            raise RuntimeError("FFmpeg 未找到，无法转换豆包返回的 AAC 音频。") from exc
        except subprocess.CalledProcessError as exc:
            detail = exc.stderr.decode("utf-8", errors="replace").strip()
            raise RuntimeError(f"豆包音频转码失败：{detail or exc.returncode}") from exc


class DoubaoWebAdapter(TtsAdapter):
    def __init__(
        self,
        settings: Settings | None = None,
        *,
        cookie_pool: DoubaoCookiePool | None = None,
        client: DoubaoWebSocketClient | None = None,
        converter: FfmpegAudioConverter | None = None,
        throttler: DoubaoRequestThrottler | None = None,
    ):
        self.settings = settings or get_settings()
        self.cookie_pool = cookie_pool or DoubaoCookiePool(self.settings.doubao_cookie_file)
        self.client = client or DoubaoWebSocketClient(
            timeout_seconds=self.settings.doubao_timeout_seconds,
            device_id_provider=DoubaoDeviceIdStore(self.settings.doubao_data_dir).current_ids,
        )
        self.converter = converter or FfmpegAudioConverter(self.settings.ffmpeg_path)
        self.throttler = throttler or get_doubao_request_throttler(self.settings.doubao_cookie_file)

    def _pool_stats(self) -> dict | None:
        stats = getattr(self.cookie_pool, "stats", None)
        if not callable(stats):
            return None
        try:
            payload = stats()
        except Exception:
            return None
        return payload if isinstance(payload, dict) else None

    @staticmethod
    def _completed_cookie_round(before: dict | None, after: dict | None) -> bool:
        if not before or not after:
            return False
        try:
            if int(after.get("totalRotations") or 0) <= int(before.get("totalRotations") or 0):
                return False
            valid_count = int(after.get("valid") or 0)
            previous_index = int((before.get("rotation") or {}).get("currentIndex") or 0)
            current_index = int((after.get("rotation") or {}).get("currentIndex") or 0)
        except (TypeError, ValueError):
            return False
        return valid_count == 1 or (valid_count > 1 and previous_index == valid_count - 1 and current_index == 0)

    def _select_cookie(self, *, interval_seconds: float, round_delay_seconds: float) -> dict | None:
        def select() -> tuple[dict | None, bool]:
            before = self._pool_stats()
            cookie = self.cookie_pool.select()
            after = self._pool_stats()
            return cookie, self._completed_cookie_round(before, after)

        return self.throttler.admit(
            select,
            interval_seconds=interval_seconds,
            round_delay_seconds=round_delay_seconds,
        )

    def synthesize_aac(
        self,
        *,
        text: str,
        voice_id: str = DEFAULT_DOUBAO_VOICE,
        speech_rate: int = 0,
        pitch: int = 0,
        request_delay_seconds: float | None = None,
        request_interval_seconds: float | None = None,
    ) -> bytes:
        """Generate the raw AAC stream while applying the shared cookie policy.

        Reader streaming and prefetch jobs both use this path so cookie rotation,
        validation and retry behaviour cannot drift from the standard speech API.
        """
        attempts = max(1, min(self.settings.doubao_retry_count + 1, 6))
        legacy_config = DoubaoLegacyConfig(self.settings.doubao_data_dir)
        round_delay = (
            legacy_config.get_item("tts.requestDelay", 15)
            if request_delay_seconds is None
            else request_delay_seconds
        )
        interval_delay = (
            self.settings.doubao_request_interval_delay_seconds
            if request_interval_seconds is None
            else request_interval_seconds
        )
        last_error: Exception | None = None
        audio: bytes | None = None
        for _attempt in range(attempts):
            cookie = self._select_cookie(
                interval_seconds=float(interval_delay),
                round_delay_seconds=float(round_delay),
            )
            if cookie is None:
                raise RuntimeError("没有可用的豆包 Cookie，请先在豆包设置中登录或添加 Cookie。")
            try:
                audio = self.client.synthesize(
                    text=text,
                    speaker=voice_id,
                    cookie=cookie["value"],
                    speech_rate=max(-50, min(100, int(speech_rate))),
                    pitch=max(-12, min(12, int(pitch))),
                )
                self.cookie_pool.record_usage(cookie["id"], success=True)
                break
            except DoubaoBlockedError as exc:
                last_error = exc
                self.cookie_pool.mark_validation(cookie["id"], valid=False, message=str(exc))
                self.cookie_pool.rotate()
            except (DoubaoRateLimitError, DoubaoProtocolError, OSError) as exc:
                last_error = exc
                self.cookie_pool.record_usage(cookie["id"], success=False, error=str(exc))
                self.cookie_pool.rotate()
        if audio is None:
            raise RuntimeError(f"豆包 TTS 生成失败：{last_error or '未知错误'}")
        return audio

    def synthesize_to_path(
        self,
        *,
        text: str,
        voice_id: str,
        output_path: Path,
        output_format: str = "mp3",
        speech_rate: int = 0,
        pitch: int = 0,
        request_delay_seconds: float | None = None,
        request_interval_seconds: float | None = None,
    ) -> Path:
        audio = self.synthesize_aac(
            text=text,
            voice_id=voice_id,
            speech_rate=speech_rate,
            pitch=pitch,
            request_delay_seconds=request_delay_seconds,
            request_interval_seconds=request_interval_seconds,
        )
        output_path.parent.mkdir(parents=True, exist_ok=True)
        temporary_path = output_path.with_name(
            f".{output_path.stem}.part{output_path.suffix or '.' + output_format}"
        )
        try:
            self.converter.convert(audio, temporary_path, output_format)
            temporary_path.replace(output_path)
        finally:
            temporary_path.unlink(missing_ok=True)
        return output_path

    def synthesize(self, request: SpeechRequest) -> SpeechResult:
        voice_id = request.voice or DEFAULT_DOUBAO_VOICE

        output_format = request.response_format.lower()
        output_path = create_output_path(self.settings.output_dir, f".{output_format}")
        self.synthesize_to_path(
            text=request.input,
            voice_id=voice_id,
            output_path=output_path,
            output_format=output_format,
            speech_rate=speed_to_speech_rate(request.speed),
            pitch=request.pitch,
        )
        if output_format == "wav":
            try:
                sample_rate, duration_seconds = read_wav_metadata(output_path)
            except Exception:
                sample_rate, duration_seconds = 24000, 0.0
        else:
            sample_rate, duration_seconds = 24000, 0.0
        return SpeechResult(
            audio_url=f"/outputs/{output_path.name}",
            file_path=str(output_path),
            model=request.model,
            sample_rate=sample_rate,
            duration_seconds=duration_seconds,
        )

    def health(self) -> dict[str, object]:
        stats = self.cookie_pool.stats()
        return {
            "status": "ok" if stats["valid"] else "needs_cookie",
            "valid_cookies": stats["valid"],
            "active_cookie": stats["active"],
        }
