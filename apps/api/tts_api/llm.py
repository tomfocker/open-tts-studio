"""Small OpenAI-compatible LLM client shared by desktop features.

The desktop keeps credentials locally; this module only receives them for the
duration of a request and never logs request headers or payloads.
"""

from __future__ import annotations

import json
from typing import Any
from urllib.parse import urlparse

import httpx


DEFAULT_SYSTEM_PROMPT = "你是一个自然、简洁的中文语音助手。回答适合直接朗读，避免使用 Markdown。"


def normalize_base_url(value: object) -> str:
    raw = str(value or "").strip().rstrip("/")
    if not raw:
        return ""
    parsed = urlparse(raw)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc or parsed.username or parsed.password:
        raise ValueError("LLM 地址必须是完整的 http(s) OpenAI 兼容地址，例如 http://127.0.0.1:11434/v1。")
    if parsed.query or parsed.fragment:
        raise ValueError("LLM 地址不能包含查询参数或片段。")
    return raw


def _headers(api_key: str) -> dict[str, str]:
    headers = {"Accept": "application/json", "Content-Type": "application/json"}
    if api_key.strip():
        headers["Authorization"] = f"Bearer {api_key.strip()}"
    return headers


def chat_completion(
    *,
    base_url: str,
    model: str,
    api_key: str = "",
    messages: list[dict[str, str]],
    temperature: float = 0.7,
    max_tokens: int = 512,
    timeout_seconds: float = 90.0,
) -> dict[str, Any]:
    endpoint = f"{normalize_base_url(base_url)}/chat/completions"
    model_name = model.strip()
    if not model_name:
        raise ValueError("请先填写 LLM 模型名。")
    payload = {
        "model": model_name,
        "messages": messages,
        "stream": False,
        "temperature": max(0.0, min(float(temperature), 2.0)),
        "max_tokens": max(1, min(int(max_tokens), 8192)),
    }
    timeout = httpx.Timeout(connect=12.0, read=timeout_seconds, write=20.0, pool=20.0)
    try:
        with httpx.Client(timeout=timeout) as client:
            response = client.post(endpoint, json=payload, headers=_headers(api_key))
            response.raise_for_status()
            result = response.json()
    except httpx.HTTPStatusError as exc:
        detail = exc.response.text[:500].strip()
        raise RuntimeError(f"LLM 返回 HTTP {exc.response.status_code}{': ' + detail if detail else ''}") from exc
    except (httpx.HTTPError, ValueError, json.JSONDecodeError) as exc:
        raise RuntimeError(f"无法连接 LLM：{exc}") from exc
    choices = result.get("choices") if isinstance(result, dict) else None
    if not isinstance(choices, list) or not choices or not isinstance(choices[0], dict):
        raise RuntimeError("LLM 返回中没有 choices。")
    message = choices[0].get("message")
    content = message.get("content") if isinstance(message, dict) else None
    if not isinstance(content, str) or not content.strip():
        raise RuntimeError("LLM 返回了空内容。")
    return {"content": content.strip(), "model": result.get("model") or model_name, "usage": result.get("usage")}


def parse_json_content(content: str) -> dict[str, Any] | None:
    candidate = content.strip()
    if candidate.startswith("```"):
        candidate = candidate.split("\n", 1)[1] if "\n" in candidate else candidate
        candidate = candidate.rsplit("```", 1)[0].strip()
    try:
        value = json.loads(candidate)
    except json.JSONDecodeError:
        start, end = candidate.find("{"), candidate.rfind("}")
        if start < 0 or end <= start:
            return None
        try:
            value = json.loads(candidate[start : end + 1])
        except json.JSONDecodeError:
            return None
    return value if isinstance(value, dict) else None
