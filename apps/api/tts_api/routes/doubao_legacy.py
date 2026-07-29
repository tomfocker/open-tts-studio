from __future__ import annotations

import hashlib
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Body, HTTPException, Query
from fastapi.responses import JSONResponse

from tts_api.config import get_app_version, get_settings, save_user_settings
from tts_api.doubao_cookies import DoubaoCookiePool
from tts_api.doubao_legacy_config import DoubaoDeviceIdStore, DoubaoLegacyConfig
from tts_api.routes.legado import reset_legado_services


router = APIRouter(prefix="/api")
SERVER_START_TIME = time.monotonic()


@router.get("/announcements")
def local_announcements() -> dict:
    # The upstream application fetched executable UI content from an external
    # Gitee repository. Our maintained build deliberately exposes a stable,
    # local-only compatibility result instead.
    return {"code": 0, "data": []}


@router.get("/force-update")
def local_force_update() -> dict:
    return {
        "code": 0,
        "data": {
            "forceUpdate": False,
            "isExcluded": False,
            "currentVersion": f"v{get_app_version()}",
        },
    }


@router.get("/service-status")
def local_service_status() -> dict:
    return {"code": 0, "status": "ok", "service": "OpenTTS Studio"}


def _success(data: Any = None, message: str | None = None, **extra) -> dict:
    payload: dict[str, Any] = {"success": True, "code": 0}
    if data is not None:
        payload["data"] = data
    if message:
        payload["message"] = message
    payload.update(extra)
    return payload


def _legacy_config() -> DoubaoLegacyConfig:
    return DoubaoLegacyConfig(get_settings().doubao_data_dir)


def _device_store() -> DoubaoDeviceIdStore:
    return DoubaoDeviceIdStore(get_settings().doubao_data_dir)


@router.get("/console/cookies")
def console_cookies() -> dict:
    pool = DoubaoCookiePool(get_settings().doubao_cookie_file)
    records = pool.list()
    stats = pool.stats()
    return _success(
        {
            "total": stats["total"],
            "valid": stats["valid"],
            "invalid": stats["total"] - stats["valid"],
            "currentCookie": (
                {"id": stats["active"]["id"], "name": stats["active"]["name"]}
                if isinstance(stats.get("active"), dict)
                else None
            ),
            "cookies": [
                {
                    "id": record["id"],
                    "name": record["name"],
                    "valid": bool(record.get("health", {}).get("isHealthy")),
                    "isActive": bool(record.get("status", {}).get("isActive")),
                }
                for record in records
            ],
        }
    )


@router.get("/console/health")
def console_health() -> dict:
    return _success({"status": "healthy", "uptime": round((time.monotonic() - SERVER_START_TIME) * 1000)})


def _log_files() -> list[Path]:
    settings = get_settings()
    files = []
    root = settings.task_log_dir
    if root.is_dir():
        files.extend(path for path in root.rglob("*") if path.is_file() and path.suffix.lower() in {".log", ".txt"})
    return list(dict.fromkeys(files))


@router.get("/console/cache-stats")
def console_cache_stats() -> dict:
    files = _log_files()
    return _success({"fileCount": len(files), "totalSize": sum(path.stat().st_size for path in files)})


@router.get("/console/clean-cache")
def console_clean_cache() -> dict:
    files = _log_files()
    total_size = 0
    deleted = 0
    for path in files:
        try:
            total_size += path.stat().st_size
            path.unlink()
            deleted += 1
        except OSError:
            pass
    return _success({"deletedCount": deleted, "totalSize": total_size}, "日志缓存清理完成")


def _sync_modern_setting(path: str, value: Any) -> None:
    mapping = {
        "prefetch.cacheConcurrent": "book_cache_concurrency",
        "tts.requestIntervalDelay": "doubao_request_interval_delay_seconds",
        "tts.maxRetries": "doubao_retry_count",
    }
    key = mapping.get(path)
    if not key:
        return
    settings = get_settings()
    normalized = value
    if key == "book_cache_concurrency":
        normalized = max(1, min(50, int(value)))
    elif key == "doubao_request_interval_delay_seconds":
        normalized = max(0, min(60, float(value)))
    elif key == "doubao_retry_count":
        normalized = max(0, min(5, int(value)))
    save_user_settings(settings.settings_file, {key: normalized})
    get_settings.cache_clear()
    reset_legado_services()


@router.get("/settings")
def legacy_get_settings() -> dict:
    config = _legacy_config().get_config()
    settings = get_settings()
    config["prefetch"]["cacheConcurrent"] = settings.book_cache_concurrency
    config["tts"]["requestIntervalDelay"] = settings.doubao_request_interval_delay_seconds
    config["tts"]["maxRetries"] = settings.doubao_retry_count
    return _success(config)


@router.post("/settings")
def legacy_update_settings(payload: dict = Body(...)) -> dict:
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="无效的请求数据")
    config = _legacy_config().update(payload)
    for section, field in (
        ("prefetch", "cacheConcurrent"),
        ("tts", "requestIntervalDelay"),
        ("tts", "maxRetries"),
    ):
        if isinstance(payload.get(section), dict) and field in payload[section]:
            _sync_modern_setting(f"{section}.{field}", payload[section][field])
    return _success(config, "配置更新成功")


@router.put("/settings/item")
def legacy_set_setting_item(payload: dict = Body(...)) -> dict:
    path = payload.get("path")
    if not path or "value" not in payload:
        raise HTTPException(status_code=400, detail="缺少path或value参数")
    try:
        _legacy_config().set_item(str(path), payload["value"])
        _sync_modern_setting(str(path), payload["value"])
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return _success({"path": path, "value": payload["value"]}, "配置项更新成功")


@router.get("/settings/item")
def legacy_get_setting_item(path: str, default: Any = Query(default=None)) -> dict:
    return _success({"path": path, "value": _legacy_config().get_item(path, default)})


@router.post("/settings/reset")
def legacy_reset_settings() -> dict:
    config = _legacy_config().reset()
    settings = get_settings()
    save_user_settings(
        settings.settings_file,
        {
            "book_cache_concurrency": config["prefetch"]["cacheConcurrent"],
            "doubao_request_interval_delay_seconds": config["tts"]["requestIntervalDelay"],
            "doubao_retry_count": min(5, config["tts"]["maxRetries"]),
        },
    )
    get_settings.cache_clear()
    reset_legado_services()
    return _success(config, "配置已重置为默认值")


@router.get("/settings/device-id")
def legacy_device_id() -> dict:
    return _success(_device_store().get())


@router.post("/settings/device-id/regenerate")
def legacy_regenerate_device_id() -> dict:
    return _success(_device_store().regenerate(), "设备ID已重新生成")


@router.post("/settings/device-id/auto-generate")
def legacy_auto_device_id(payload: dict = Body(...)) -> dict:
    if not isinstance(payload.get("enabled"), bool):
        raise HTTPException(status_code=400, detail="enabled参数必须是布尔值")
    data = _device_store().set_auto_generate(payload["enabled"])
    return _success(data, "已启用自动生成设备ID" if payload["enabled"] else "已禁用自动生成设备ID")


@router.post("/settings/update")
def legacy_self_update() -> JSONResponse:
    return JSONResponse(
        status_code=410,
        content={
            "success": False,
            "code": 410,
            "message": "当前维护版使用桌面端安全更新，不再支持上传压缩包覆盖正在运行的程序。",
        },
    )


def _documents() -> list[dict]:
    settings = get_settings()
    roots = [settings.workspace_root / "docs"]
    candidates = []
    readme = settings.workspace_root / "README.md"
    if readme.is_file():
        candidates.append(readme)
    for root in roots:
        if root.is_dir():
            candidates.extend(root.rglob("*.md"))
    documents = []
    for path in sorted(set(candidates), key=lambda item: str(item).casefold()):
        relative = path.relative_to(settings.workspace_root).as_posix()
        document_id = hashlib.sha1(relative.encode("utf-8"), usedforsecurity=False).hexdigest()
        stat = path.stat()
        documents.append(
            {
                "id": document_id,
                "filename": path.name,
                "name": path.stem,
                "path": relative,
                "downloadUrl": None,
                "size": stat.st_size,
                "modifiedTime": datetime.fromtimestamp(stat.st_mtime, timezone.utc).isoformat(),
                "_file": path,
            }
        )
    return documents


def _public_document(document: dict) -> dict:
    return {key: value for key, value in document.items() if key != "_file"}


@router.get("/docs")
def legacy_docs() -> dict:
    docs = [_public_document(document) for document in _documents()]
    return _success(docs, "获取文档列表成功")


@router.post("/docs/refresh")
def legacy_docs_refresh() -> dict:
    docs = [_public_document(document) for document in _documents()]
    return _success(docs, "刷新文档列表成功")


@router.get("/docs/search")
def legacy_docs_search(q: str) -> dict:
    keyword = q.strip().casefold()
    if not keyword:
        raise HTTPException(status_code=400, detail="搜索关键词不能为空")
    matches = []
    for document in _documents():
        name_match = keyword in document["name"].casefold()
        content_match = False
        if not name_match:
            try:
                content_match = keyword in document["_file"].read_text(encoding="utf-8").casefold()
            except OSError:
                pass
        if name_match or content_match:
            matches.append({**_public_document(document), "nameMatch": name_match, "contentMatch": content_match})
    return _success(matches, f"搜索完成，找到 {len(matches)} 个结果")


@router.get("/docs/{document_id}")
def legacy_doc_content(document_id: str) -> dict:
    document = next((item for item in _documents() if item["id"] == document_id), None)
    if not document:
        raise HTTPException(status_code=404, detail="文档不存在")
    try:
        content = document["_file"].read_text(encoding="utf-8")
    except OSError as exc:
        raise HTTPException(status_code=500, detail="读取文档失败") from exc
    data = {
        **_public_document(document),
        "extension": ".md",
        "content": content,
        "createdTime": document["modifiedTime"],
    }
    return _success(data, "获取文档内容成功")


@router.delete("/audio/{filename}")
def legacy_delete_audio(filename: str) -> dict:
    if Path(filename).name != filename:
        raise HTTPException(status_code=404, detail="文件不存在")
    path = get_settings().output_dir / filename
    if not path.is_file():
        raise HTTPException(status_code=404, detail="文件不存在")
    path.unlink()
    return _success({"deleted": True})
