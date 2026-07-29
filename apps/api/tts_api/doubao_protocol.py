from __future__ import annotations

import json
import random
import string
from dataclasses import dataclass
from typing import Callable, Iterator
from urllib.parse import urlencode


DOUBAO_TTS_WS_URL = "wss://ws-samantha.doubao.com/samantha/audio/tts"
DEFAULT_USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/131.0.0.0 Safari/537.36"
)


class DoubaoProtocolError(RuntimeError):
    """The Doubao web endpoint returned an invalid or explicit error response."""


class DoubaoBlockedError(DoubaoProtocolError):
    """The active account was blocked by the upstream endpoint."""


class DoubaoRateLimitError(DoubaoProtocolError):
    """The upstream endpoint rejected the request because of rate limiting."""


class DoubaoEmptyAudioError(DoubaoProtocolError):
    """The endpoint completed without returning audio bytes."""


@dataclass(frozen=True)
class DoubaoTtsConfig:
    aid: int = 497858
    pc_version: str = "3.11.1"
    language: str = "zh"
    device_platform: str = "web"
    region: str = "CN"
    sys_region: str = "CN"
    use_olympus_account: int = 1
    pkg_type: str = "release_version"


def extract_device_fingerprint(cookie: str) -> str | None:
    for part in cookie.split(";"):
        name, separator, value = part.strip().partition("=")
        if separator and name == "s_v_web_id" and value.strip():
            return value.strip()
    return None


def _javascript_signed_int32(value: int) -> int:
    value &= 0xFFFFFFFF
    return value - 0x100000000 if value & 0x80000000 else value


def generate_device_id_from_fingerprint(
    fingerprint: str | None,
    seed: int,
    fallback: str,
) -> str:
    if not fingerprint:
        return fallback
    value = _javascript_signed_int32(seed)
    for character in fingerprint:
        value = _javascript_signed_int32((value << 5) - value + ord(character))
    result = str(abs(value))
    index = 0
    while len(result) < 19 and index < len(fingerprint):
        result += str(ord(fingerprint[index]))
        index += 1
    return result[:19]


def generate_web_tab_id(random_choice: Callable[[str], str] = random.choice) -> str:
    template = "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx"
    hexadecimal = string.hexdigits[:16]
    output: list[str] = []
    for character in template:
        if character == "x":
            output.append(random_choice(hexadecimal))
        elif character == "y":
            output.append(format((int(random_choice(hexadecimal), 16) & 0x3) | 0x8, "x"))
        else:
            output.append(character)
    return "".join(output)


def build_doubao_ws_url(
    *,
    speaker: str,
    speech_rate: int = 0,
    pitch: int = 0,
    cookie: str = "",
    config: DoubaoTtsConfig | None = None,
    fallback_device_id: str = "0" * 19,
    fallback_web_id: str = "1" * 19,
    web_tab_id: str | None = None,
) -> str:
    active_config = config or DoubaoTtsConfig()
    fingerprint = extract_device_fingerprint(cookie)
    device_id = generate_device_id_from_fingerprint(
        fingerprint,
        2654435769,
        fallback_device_id,
    )
    web_id = generate_device_id_from_fingerprint(
        fingerprint,
        2246822507,
        fallback_web_id,
    )
    parameters = {
        "speaker": speaker,
        "format": "aac",
        "speech_rate": str(max(-50, min(100, int(speech_rate)))),
        "pitch": str(max(-12, min(12, int(pitch)))),
        "version_code": "20800",
        "language": active_config.language,
        "device_platform": active_config.device_platform,
        "aid": str(active_config.aid),
        "real_aid": str(active_config.aid),
        "pkg_type": active_config.pkg_type,
        "device_id": device_id,
        "pc_version": active_config.pc_version,
        "web_id": web_id,
        "tea_uuid": web_id,
        "region": active_config.region,
        "sys_region": active_config.sys_region,
        "samantha_web": "1",
        "use-olympus-account": str(active_config.use_olympus_account),
        "web_tab_id": web_tab_id or generate_web_tab_id(),
    }
    return f"{DOUBAO_TTS_WS_URL}?{urlencode(parameters)}"


def _decode_event(message: str | bytes) -> dict | None:
    if isinstance(message, bytes):
        try:
            text = message.decode("utf-8")
        except UnicodeDecodeError:
            return None
    else:
        text = message
    try:
        payload = json.loads(text)
    except (TypeError, json.JSONDecodeError):
        return None
    return payload if isinstance(payload, dict) else None


def _raise_for_event(payload: dict) -> None:
    code = payload.get("code")
    message = str(payload.get("message") or payload.get("error") or "").strip()
    if not message and code in (None, 0):
        return
    normalized = message.lower()
    if message == "block" or code == 710022002:
        raise DoubaoBlockedError(message or f"Doubao blocked the request ({code}).")
    if "rate limited" in normalized or code == 671000003:
        raise DoubaoRateLimitError(message or f"Doubao rate limited the request ({code}).")
    if payload.get("error") or code not in (None, 0):
        raise DoubaoProtocolError(message or f"Doubao returned error code {code}.")


class DoubaoWebSocketClient:
    def __init__(
        self,
        *,
        connector=None,
        timeout_seconds: float = 30.0,
        user_agent: str = DEFAULT_USER_AGENT,
        device_id_provider: Callable[[], tuple[str, str]] | None = None,
    ):
        self.connector = connector
        self.timeout_seconds = timeout_seconds
        self.user_agent = user_agent
        self.device_id_provider = device_id_provider

    def _connect(self, url: str, cookie: str):
        connector = self.connector
        if connector is None:
            from websockets.sync.client import connect

            connector = connect
        return connector(
            url,
            origin="https://www.doubao.com",
            additional_headers={
                "Accept-Language": "zh,zh-CN;q=0.9",
                "Cache-Control": "no-cache",
                "Pragma": "no-cache",
                "User-Agent": self.user_agent,
                "Cookie": cookie,
            },
            open_timeout=self.timeout_seconds,
            close_timeout=5,
            max_size=None,
        )

    def synthesize(
        self,
        *,
        text: str,
        speaker: str,
        cookie: str,
        speech_rate: int = 0,
        pitch: int = 0,
    ) -> bytes:
        if not text.strip():
            raise ValueError("Text cannot be empty.")
        if not cookie.strip():
            raise ValueError("A Doubao web cookie is required.")
        fallback_device_id, fallback_web_id = ("0" * 19, "1" * 19)
        if self.device_id_provider is not None:
            fallback_device_id, fallback_web_id = self.device_id_provider()
        url = build_doubao_ws_url(
            speaker=speaker,
            speech_rate=speech_rate,
            pitch=pitch,
            cookie=cookie,
            fallback_device_id=fallback_device_id,
            fallback_web_id=fallback_web_id,
        )
        chunks: list[bytes] = []
        with self._connect(url, cookie) as websocket:
            websocket.send(json.dumps({"event": "text", "text": text}, ensure_ascii=False))
            websocket.send(json.dumps({"event": "finish"}))
            for message in self._messages(websocket):
                payload = _decode_event(message)
                if payload is not None:
                    _raise_for_event(payload)
                    if payload.get("event") == "finish":
                        break
                    continue
                if isinstance(message, bytes) and self._looks_like_audio(message):
                    chunks.append(message)
        if not chunks:
            raise DoubaoEmptyAudioError("Doubao completed without returning audio data.")
        return b"".join(chunks)

    def validate_cookie(self, cookie: str) -> tuple[bool, str]:
        try:
            self.synthesize(
                text="测试",
                speaker="BV700_V2_streaming",
                cookie=cookie,
            )
        except Exception as exc:
            return False, str(exc)
        return True, "Cookie有效"

    def _messages(self, websocket) -> Iterator[str | bytes]:
        while True:
            try:
                yield websocket.recv(timeout=self.timeout_seconds)
            except StopIteration:
                return
            except TimeoutError as exc:
                raise DoubaoProtocolError("Timed out waiting for Doubao audio data.") from exc
            except Exception as exc:
                if exc.__class__.__name__ in {"ConnectionClosed", "ConnectionClosedOK"}:
                    return
                raise

    @staticmethod
    def _looks_like_audio(message: bytes) -> bool:
        if len(message) < 2:
            return False
        return (
            message.startswith(b"ID3")
            or message[0] == 0xFF
            and (message[1] & 0xE0) == 0xE0
        )
