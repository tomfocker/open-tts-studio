from __future__ import annotations

import base64
import io
import secrets
import string
import threading
import time
from dataclasses import dataclass
from http.cookies import SimpleCookie
from typing import Callable
from uuid import uuid4

import httpx

from tts_api.doubao_protocol import DEFAULT_USER_AGENT


DOUBAO_QR_START_URL = "https://www.doubao.com/passport/web/get_qrcode/"
DOUBAO_QR_STATUS_URL = "https://www.doubao.com/passport/web/check_qrconnect/"
DOUBAO_LOGIN_REFERER = "https://www.doubao.com/chat/?from_logout=1"


def _random_text(length: int, alphabet: str = string.ascii_letters + string.digits) -> str:
    return "".join(secrets.choice(alphabet) for _ in range(length))


def _default_qr_encoder(content: str) -> str:
    import qrcode

    image = qrcode.make(content)
    output = io.BytesIO()
    image.save(output, format="PNG")
    return "data:image/png;base64," + base64.b64encode(output.getvalue()).decode("ascii")


def _cookie_header_from_set_cookie(headers: list[str]) -> str:
    values: dict[str, str] = {}
    for header in headers:
        cookie = SimpleCookie()
        try:
            cookie.load(header)
        except Exception:
            cookie = SimpleCookie()
        for name, morsel in cookie.items():
            values[name] = morsel.value
        if not cookie:
            first = header.split(";", 1)[0].strip()
            name, separator, value = first.partition("=")
            if separator and name:
                values[name] = value
    return "; ".join(f"{name}={value}" for name, value in values.items())


@dataclass
class QrLoginSession:
    id: str
    token: str
    qr_code_url: str
    qr_code_image: str
    verify_fp: str
    csrf_token: str
    created_at: float
    status: str = "pending"
    cookie: str | None = None


class DoubaoQrLoginManager:
    def __init__(
        self,
        *,
        http_client=None,
        qr_encoder: Callable[[str], str] | None = None,
        now: Callable[[], float] = time.time,
        expiry_seconds: int = 60,
    ):
        self.http_client = http_client or httpx.Client(follow_redirects=False)
        self.qr_encoder = qr_encoder or _default_qr_encoder
        self.now = now
        self.expiry_seconds = expiry_seconds
        self.sessions: dict[str, QrLoginSession] = {}
        self._lock = threading.RLock()

    def start(self) -> dict:
        verify_fp = "verify_" + _random_text(32)
        csrf_token = _random_text(32, "abcdef0123456789")
        parameters = {
            "next": "https://www.doubao.com",
            "aid": "497858",
            "account_sdk_source": "web",
            "sdk_version": "2.2.11-doubao.0",
            "verifyFp": verify_fp,
            "fp": verify_fp,
        }
        response = self.http_client.get(
            DOUBAO_QR_START_URL,
            params=parameters,
            headers=self._headers(csrf_token),
            timeout=30,
        )
        response.raise_for_status()
        payload = response.json()
        data = payload.get("data") if isinstance(payload, dict) else None
        if not isinstance(data, dict):
            description = payload.get("description") if isinstance(payload, dict) else None
            raise RuntimeError(description or "获取豆包二维码失败：响应格式不正确")
        qr_code_url = str(data.get("qrcode_index_url") or data.get("scan_url") or "")
        raw_image = str(data.get("qrcode") or "")
        if raw_image.startswith("iVBORw0KGgo"):
            qr_code_image = "data:image/png;base64," + raw_image
        elif qr_code_url:
            qr_code_image = self.qr_encoder(qr_code_url)
        else:
            raise RuntimeError("获取豆包二维码失败：未返回二维码数据")
        session = QrLoginSession(
            id=uuid4().hex,
            token=str(data.get("token") or ""),
            qr_code_url=qr_code_url,
            qr_code_image=qr_code_image,
            verify_fp=verify_fp,
            csrf_token=csrf_token,
            created_at=self.now(),
        )
        if not session.token:
            raise RuntimeError("获取豆包二维码失败：未返回登录令牌")
        with self._lock:
            self._clean_expired_locked()
            self.sessions[session.id] = session
        return {
            "sessionId": session.id,
            "qrCodeUrl": session.qr_code_url,
            "qrCodeImg": session.qr_code_image,
            "expiresIn": self.expiry_seconds,
        }

    def check(self, session_id: str) -> dict:
        with self._lock:
            session = self.sessions.get(session_id)
            if session is None or self._expired(session):
                self.sessions.pop(session_id, None)
                return {"status": "expired", "message": "二维码已过期"}
            if session.status == "confirmed" and session.cookie:
                return {"status": "confirmed", "message": "登录已确认"}

        response = self.http_client.get(
            DOUBAO_QR_STATUS_URL,
            params={
                "next": "https://www.doubao.com",
                "token": session.token,
                "aid": "497858",
                "account_sdk_source": "web",
                "sdk_version": "2.2.11-doubao.0",
                "verifyFp": session.verify_fp,
                "fp": session.verify_fp,
            },
            headers=self._headers(session.csrf_token),
            timeout=30,
        )
        response.raise_for_status()
        payload = response.json()
        data = payload.get("data", {}) if isinstance(payload, dict) else {}
        status = str(data.get("status") or "pending")
        set_cookie_headers = response.headers.get_list("set-cookie")
        if status == "confirmed" or data.get("redirect_url"):
            cookie = _cookie_header_from_set_cookie(set_cookie_headers)
            if cookie:
                with self._lock:
                    session.status = "confirmed"
                    session.cookie = cookie
                return {"status": "confirmed", "message": "登录已确认"}
        if status == "scanned":
            with self._lock:
                session.status = "scanned"
            return {"status": "scanned", "message": "二维码已扫描，请在手机上确认登录"}
        return {"status": "pending", "message": "等待扫描二维码"}

    def consume_cookie(self, session_id: str) -> str:
        with self._lock:
            session = self.sessions.get(session_id)
            if session is None or self._expired(session):
                self.sessions.pop(session_id, None)
                raise KeyError(session_id)
            if session.status != "confirmed" or not session.cookie:
                raise RuntimeError("请先在手机上确认登录")
            cookie = session.cookie
            del self.sessions[session_id]
            return cookie

    def count(self) -> int:
        with self._lock:
            self._clean_expired_locked()
            return len(self.sessions)

    def _headers(self, csrf_token: str) -> dict[str, str]:
        return {
            "Accept": "application/json, text/javascript",
            "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
            "Content-Type": "application/x-www-form-urlencoded",
            "Referer": DOUBAO_LOGIN_REFERER,
            "User-Agent": DEFAULT_USER_AGENT,
            "x-tt-passport-csrf-token": csrf_token,
            "Sec-Fetch-Dest": "empty",
            "Sec-Fetch-Mode": "cors",
            "Sec-Fetch-Site": "same-origin",
        }

    def _expired(self, session: QrLoginSession) -> bool:
        return self.now() - session.created_at > self.expiry_seconds

    def _clean_expired_locked(self) -> None:
        for session_id, session in list(self.sessions.items()):
            if self._expired(session):
                del self.sessions[session_id]


_qr_login_manager: DoubaoQrLoginManager | None = None


def get_qr_login_manager() -> DoubaoQrLoginManager:
    global _qr_login_manager
    if _qr_login_manager is None:
        _qr_login_manager = DoubaoQrLoginManager()
    return _qr_login_manager
