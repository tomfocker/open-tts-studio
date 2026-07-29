from __future__ import annotations

from dataclasses import dataclass
from typing import Any
from urllib.parse import urlsplit

import httpx


class LegadoClientError(RuntimeError):
    """A readable error raised while talking to Legado's Web service."""


def _extract_payload(payload: Any) -> Any:
    if isinstance(payload, dict) and payload.get("isSuccess") is False:
        raise LegadoClientError(str(payload.get("errorMsg") or "阅读 Web 服务返回错误"))
    return payload


@dataclass
class LegadoApiClient:
    timeout_seconds: float = 10.0
    client: Any | None = None

    def _base_url(self, server_ip: str, server_port: int | str) -> str:
        host = str(server_ip).strip()
        if not host:
            raise LegadoClientError("服务器IP和端口不能为空")
        try:
            port = int(server_port)
        except (TypeError, ValueError) as exc:
            raise LegadoClientError("阅读 Web 服务端口无效") from exc
        if not 1 <= port <= 65535:
            raise LegadoClientError("阅读 Web 服务端口无效")

        # Accept an IP/hostname or a URL copied from the Legado settings page,
        # but never let a path/query escape into the generated endpoint.
        candidate = host if "://" in host else f"http://{host}"
        parsed = urlsplit(candidate)
        if parsed.scheme not in {"http", "https"} or not parsed.hostname:
            raise LegadoClientError("阅读 Web 服务地址无效")
        display_host = f"[{parsed.hostname}]" if ":" in parsed.hostname else parsed.hostname
        return f"{parsed.scheme}://{display_host}:{port}"

    def _request(self, method: str, url: str, **kwargs) -> httpx.Response:
        requester = self.client or httpx
        try:
            response = requester.request(method, url, timeout=self.timeout_seconds, **kwargs)
            response.raise_for_status()
            return response
        except httpx.ConnectError as exc:
            raise LegadoClientError("连接被拒绝，请检查阅读 Web 服务是否启动") from exc
        except httpx.TimeoutException as exc:
            raise LegadoClientError("连接超时，请检查网络或服务器地址") from exc
        except httpx.HTTPStatusError as exc:
            detail = ""
            try:
                payload = exc.response.json()
                detail = str(payload.get("errorMsg") or payload.get("message") or "")
            except Exception:
                detail = exc.response.text[:300]
            raise LegadoClientError(detail or f"阅读 Web 服务返回 HTTP {exc.response.status_code}") from exc
        except httpx.HTTPError as exc:
            raise LegadoClientError(f"阅读 Web 服务请求失败：{exc}") from exc

    def _json(self, method: str, url: str, **kwargs) -> Any:
        response = self._request(method, url, **kwargs)
        try:
            return _extract_payload(response.json())
        except ValueError as exc:
            raise LegadoClientError("阅读 Web 服务返回了无效 JSON") from exc

    def get_bookshelf(self, server_ip: str, server_port: int | str) -> Any:
        return self._json("GET", f"{self._base_url(server_ip, server_port)}/getBookshelf")

    def get_chapter_list(self, server_ip: str, server_port: int | str, book_url: str) -> Any:
        if not str(book_url).strip():
            raise LegadoClientError("书籍URL不能为空")
        return self._json(
            "GET",
            f"{self._base_url(server_ip, server_port)}/getChapterList",
            params={"url": book_url},
        )

    def get_chapter_content(
        self,
        server_ip: str,
        server_port: int | str,
        book_url: str,
        chapter_index: int,
    ) -> Any:
        if not str(book_url).strip():
            raise LegadoClientError("书籍URL不能为空")
        return self._json(
            "GET",
            f"{self._base_url(server_ip, server_port)}/getBookContent",
            params={"url": book_url, "index": int(chapter_index)},
        )

    def get_cover(
        self,
        server_ip: str,
        server_port: int | str,
        cover_path: str,
    ) -> tuple[bytes, str]:
        if not str(cover_path).strip():
            raise LegadoClientError("封面路径不能为空")
        response = self._request(
            "GET",
            f"{self._base_url(server_ip, server_port)}/cover",
            params={"path": cover_path},
        )
        return response.content, response.headers.get("content-type", "image/jpeg")


def unwrap_list(payload: Any) -> list[dict]:
    if isinstance(payload, dict):
        payload = payload.get("data", [])
    return [item for item in payload if isinstance(item, dict)] if isinstance(payload, list) else []


def unwrap_content(payload: Any) -> str:
    """Handle the response shapes used by different Legado Web versions."""

    current = payload
    for _ in range(4):
        if isinstance(current, str):
            return current
        if not isinstance(current, dict):
            break
        for key in ("content", "text", "body", "result", "value", "data"):
            value = current.get(key)
            if value not in (None, ""):
                current = value
                break
        else:
            break
    return current if isinstance(current, str) else ""
