from __future__ import annotations

import json
import time
from pathlib import Path

import httpx
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from tts_api.adapters.doubao_web import DoubaoWebAdapter
from tts_api.config import get_settings
from tts_api.doubao_cookies import DoubaoCookiePool
from tts_api.doubao_protocol import DOUBAO_TTS_WS_URL, DoubaoWebSocketClient
from tts_api.doubao_qr_login import get_qr_login_manager
from tts_api.schemas import SpeechRequest


router = APIRouter()
SERVER_START_TIME = time.monotonic()


class CookieCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    value: str = Field(min_length=1, max_length=10000)
    description: str = Field(default="", max_length=500)


class CookieUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    value: str | None = Field(default=None, min_length=1, max_length=10000)
    description: str | None = Field(default=None, max_length=500)


class CookieRotationRequest(BaseModel):
    cookieId: str | None = None


class CookieRotationConfigRequest(BaseModel):
    usageLimitEnabled: bool = True
    usageCountPerCookie: int = Field(default=10, ge=1, le=1000)


class CookieUsageLimitRequest(BaseModel):
    limit: int = Field(ge=0, le=10000)


class CookieBatchTestRequest(BaseModel):
    indexes: list[int] = Field(min_length=1)


class LegacyTtsRequest(BaseModel):
    text: str = Field(min_length=1)
    speaker: str | None = None
    voiceId: str | None = None
    rate: int | None = Field(default=None, ge=-50, le=100)
    speech_rate: int | None = Field(default=None, ge=-50, le=100)
    pitch: int = Field(default=0, ge=-12, le=12)


class QrStatusRequest(BaseModel):
    sessionId: str = Field(min_length=1)


class QrConfirmRequest(QrStatusRequest):
    cookieName: str = Field(min_length=1, max_length=100)


def _pool() -> DoubaoCookiePool:
    return DoubaoCookiePool(get_settings().doubao_cookie_file)


def _success(data=None, message: str | None = None, **extra) -> dict:
    payload = {"success": True, "code": 0}
    if data is not None:
        payload["data"] = data
    if message:
        payload["message"] = message
    payload.update(extra)
    return payload


def _resolve_cookie(pool: DoubaoCookiePool, cookie_id: str, *, include_value: bool = False) -> dict:
    record = pool.get(cookie_id, include_value=include_value)
    if record is None:
        raise HTTPException(status_code=404, detail="Cookie不存在")
    return record


def _load_voices() -> list[dict]:
    path = get_settings().doubao_voice_catalog_path
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise HTTPException(status_code=500, detail="豆包音色目录不可用") from exc
    voices = payload.get("voices", []) if isinstance(payload, dict) else []
    return voices if isinstance(voices, list) else []


@router.get("/v1/doubao/status")
@router.get("/api/console/status")
def get_doubao_status() -> dict:
    stats = _pool().stats()
    return _success(
        {
            "service": {
                "status": "running",
                "uptimeMs": round((time.monotonic() - SERVER_START_TIME) * 1000),
                "version": "1.0.0",
            },
            "provider": "doubao-web",
            "status": "ready" if stats["valid"] else "needs_cookie",
            "endpoint": DOUBAO_TTS_WS_URL,
            "cookies": stats,
            "queue": {"size": 0},
        },
        "服务正常" if stats["valid"] else "请先添加有效 Cookie",
    )


@router.post("/v1/doubao/auth/qr-code")
@router.post("/api/auth/qr-code")
def start_qr_login() -> dict:
    try:
        data = get_qr_login_manager().start()
    except httpx.HTTPStatusError as exc:
        if exc.response.status_code == 403:
            raise HTTPException(status_code=503, detail="豆包拦截了扫码登录请求，请手动添加 Cookie") from exc
        if exc.response.status_code == 429:
            raise HTTPException(status_code=429, detail="请求过于频繁，请稍后再试") from exc
        raise HTTPException(status_code=502, detail="豆包扫码登录服务请求失败") from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return _success(data, "二维码获取成功")


@router.post("/v1/doubao/auth/qr-status")
@router.post("/api/auth/qr-status")
def check_qr_login(request: QrStatusRequest) -> dict:
    try:
        data = get_qr_login_manager().check(request.sessionId)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return _success(data, data["message"])


@router.post("/v1/doubao/auth/qr-confirm")
@router.post("/api/auth/qr-confirm")
def confirm_qr_login(request: QrConfirmRequest) -> dict:
    manager = get_qr_login_manager()
    try:
        cookie = manager.consume_cookie(request.sessionId)
        record = _pool().add(name=request.cookieName.strip(), value=cookie, description="通过豆包扫码登录添加")
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="会话不存在或已过期") from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return _success({"id": record["id"], "name": record["name"]}, "二维码登录成功，Cookie已保存")


@router.get("/v1/doubao/auth/qr-sessions")
@router.get("/api/auth/qr-sessions")
def count_qr_sessions() -> dict:
    return _success({"sessionCount": get_qr_login_manager().count()}, "获取会话数量成功")


@router.get("/v1/doubao/voices")
@router.get("/api/voices")
@router.get("/voices/")
@router.get("/voices/voices")
def list_doubao_voices(
    query: str | None = Query(default=None),
    gender: str | None = Query(default=None),
) -> dict:
    voices = _load_voices()
    if query:
        lowered = query.casefold()
        voices = [
            voice
            for voice in voices
            if lowered in str(voice.get("name", "")).casefold()
            or lowered in str(voice.get("style_id", "")).casefold()
            or any(lowered in str(tag).casefold() for tag in voice.get("tags", []))
        ]
    if gender:
        voices = [voice for voice in voices if voice.get("gender") == gender]
    return _success(voices, "获取发音人列表成功", total=len(voices))


@router.get("/api/voices/search")
@router.get("/voices/voices/search")
def search_doubao_voices(
    q: str | None = None,
    language: str | None = None,
    gender: str | None = None,
) -> dict:
    voices = _load_voices()
    if q:
        lowered = q.casefold()
        voices = [
            voice
            for voice in voices
            if lowered in str(voice.get("name", "")).casefold()
            or lowered in str(voice.get("style_id", "")).casefold()
            or any(lowered in str(tag).casefold() for tag in voice.get("tags", []))
        ]
    if language:
        voices = [voice for voice in voices if str(voice.get("language", "zh-CN")).casefold().startswith(language.casefold())]
    if gender:
        voices = [voice for voice in voices if str(voice.get("gender", "")).casefold() == gender.casefold()]
    return _success(voices, "搜索发音人成功", total=len(voices))


@router.get("/v1/doubao/cookies")
@router.get("/api/cookies")
def list_cookies() -> dict:
    pool = _pool()
    records = pool.list()
    return _success(records, "获取Cookie列表成功", total=len(records), stats=pool.stats())


@router.get("/v1/doubao/cookies/stats")
@router.get("/api/cookies/stats")
def cookie_stats() -> dict:
    return _success(_pool().stats(), "获取统计信息成功")


@router.post("/v1/doubao/cookies/rotation-config")
@router.post("/api/cookies/rotation-config")
def configure_cookie_rotation(request: CookieRotationConfigRequest) -> dict:
    rotation = _pool().configure_rotation(
        usage_limit_enabled=request.usageLimitEnabled,
        usage_count_per_cookie=request.usageCountPerCookie,
    )
    return _success(rotation, "Cookie轮换配置已更新")


@router.post("/v1/doubao/cookies/rotate")
@router.post("/api/cookies/rotate")
def rotate_cookie(request: CookieRotationRequest) -> dict:
    try:
        record = _pool().rotate(request.cookieId)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Cookie不存在") from exc
    if record is None:
        raise HTTPException(status_code=409, detail="没有可用的Cookie")
    return _success(record, "Cookie切换成功")


@router.post("/v1/doubao/cookies/batch/test")
@router.post("/api/cookies/batch/test")
def test_all_cookies(request: CookieBatchTestRequest) -> dict:
    pool = _pool()
    client = DoubaoWebSocketClient(timeout_seconds=get_settings().doubao_timeout_seconds)
    public_records = pool.list()
    results: list[dict] = []
    selected: list[tuple[int, dict]] = []
    seen: set[int] = set()
    for index in request.indexes:
        if index in seen:
            continue
        seen.add(index)
        if index < 0 or index >= len(public_records):
            results.append({"index": index, "success": False, "error": f"Cookie索引 {index} 不存在"})
            continue
        selected.append((index, public_records[index]))
    if not selected:
        raise HTTPException(status_code=400, detail="没有有效的Cookie可以测试")

    success_count = 0
    fail_count = 0
    for index, public_record in selected:
        record = pool.get(public_record["id"], include_value=True)
        valid, message = client.validate_cookie(record["value"])
        updated = pool.mark_validation(record["id"], valid=valid, message=message)
        checked_at = updated["status"]["lastValidated"]
        success_count += int(valid)
        fail_count += int(not valid)
        results.append(
            {
                "index": index,
                "cookieId": record["id"],
                "name": record["name"],
                "success": valid,
                "result": {
                    "isValid": valid,
                    "message": message,
                    "checkedAt": checked_at,
                    "duration": None,
                },
            }
        )
    return _success(
        {
            "successCount": success_count,
            "failCount": fail_count,
            "total": len(results),
            "results": results,
        },
        f"批量测试完成: 成功 {success_count} 个，失败 {fail_count} 个",
    )


@router.delete("/v1/doubao/cookies")
@router.delete("/api/cookies")
def clear_cookies() -> dict:
    count = _pool().clear()
    return _success({"deleted": count}, "所有Cookie已清空")


@router.get("/v1/doubao/cookies/{cookie_id}")
@router.get("/api/cookies/{cookie_id}")
def get_cookie(cookie_id: str, reveal: bool = Query(default=True)) -> dict:
    return _success(_resolve_cookie(_pool(), cookie_id, include_value=reveal), "获取Cookie成功")


@router.post("/v1/doubao/cookies", status_code=201)
@router.post("/api/cookies", status_code=201)
def add_cookie(request: CookieCreate) -> dict:
    try:
        record = _pool().add(**request.model_dump())
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return _success(record, "Cookie添加成功")


@router.put("/v1/doubao/cookies/{cookie_id}")
@router.put("/api/cookies/{cookie_id}")
def update_cookie(cookie_id: str, request: CookieUpdate) -> dict:
    try:
        record = _pool().update(cookie_id, request.model_dump(exclude_none=True))
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Cookie不存在") from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return _success(record, "Cookie更新成功")


@router.delete("/v1/doubao/cookies/{cookie_id}")
@router.delete("/api/cookies/{cookie_id}")
def delete_cookie(cookie_id: str) -> dict:
    try:
        _pool().delete(cookie_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Cookie不存在") from exc
    return _success(message="Cookie删除成功")


@router.post("/v1/doubao/cookies/{cookie_id}/test")
@router.post("/api/cookies/{cookie_id}/test")
def test_cookie(cookie_id: str) -> dict:
    pool = _pool()
    record = _resolve_cookie(pool, cookie_id, include_value=True)
    client = DoubaoWebSocketClient(timeout_seconds=get_settings().doubao_timeout_seconds)
    valid, message = client.validate_cookie(record["value"])
    updated = pool.mark_validation(cookie_id, valid=valid, message=message)
    return _success({**updated, "isValid": valid, "validationMessage": message}, message)


@router.post("/v1/doubao/cookies/{cookie_id}/toggle")
@router.post("/api/cookies/{cookie_id}/toggle")
def toggle_cookie(cookie_id: str) -> dict:
    pool = _pool()
    record = _resolve_cookie(pool, cookie_id)
    updated = pool.set_disabled(cookie_id, not record["status"]["isDisabled"])
    return _success(updated, "Cookie状态已更新")


@router.put("/v1/doubao/cookies/{cookie_id}/usage-limit")
@router.put("/api/cookies/{cookie_id}/usage-limit")
def set_cookie_usage_limit(cookie_id: str, request: CookieUsageLimitRequest) -> dict:
    pool = _pool()
    _resolve_cookie(pool, cookie_id)
    updated = pool.set_usage_limit(cookie_id, request.limit)
    return _success({"id": updated["id"], "name": updated["name"], "limit": request.limit}, "Cookie使用限制已更新")


@router.post("/api/tts")
@router.post("/api/")
@router.post("/tts/")
@router.post("/tts/tts")
def legacy_tts(request: LegacyTtsRequest) -> dict:
    voice_id = request.voiceId or request.speaker
    if not voice_id:
        raise HTTPException(status_code=400, detail="缺少必需参数：speaker 或 voiceId")
    rate = request.rate if request.rate is not None else request.speech_rate or 0
    adapter = DoubaoWebAdapter(settings=get_settings())
    result = adapter.synthesize(
        SpeechRequest(
            model="doubao-web",
            input=request.text,
            voice=voice_id,
            speed=max(0.25, min(4.0, 1 + rate / 50)),
            pitch=request.pitch,
            response_format="mp3",
        )
    )
    path = Path(result.file_path)
    voice = next((item for item in _load_voices() if item.get("style_id") == voice_id), None)
    return _success(
        {
            "filePath": result.file_path,
            "url": result.audio_url,
            "size": path.stat().st_size,
            "voice": voice.get("name") if voice else voice_id,
        },
        "TTS生成成功",
    )


@router.get("/tts/health")
def legacy_tts_health() -> dict:
    return {"status": "ok", "service": "tts", "timestamp": int(time.time() * 1000)}
