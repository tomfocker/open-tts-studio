from __future__ import annotations

import json
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterator
from urllib.parse import urlsplit

from fastapi import APIRouter, Body, HTTPException, Query, Request
from fastapi.responses import FileResponse, Response, StreamingResponse

from tts_api.adapters.doubao_web import DEFAULT_DOUBAO_VOICE, DoubaoWebAdapter
from tts_api.config import Settings, get_settings
from tts_api.doubao_cache import (
    SILENT_MP3,
    BookCacheProgressStore,
    BookCacheService,
    PrefetchAudioCache,
    safe_cache_id,
)
from tts_api.doubao_prefetch import DoubaoPrefetchManager
from tts_api.doubao_legacy_config import DoubaoLegacyConfig
from tts_api.legado_client import LegadoApiClient, LegadoClientError, unwrap_list


router = APIRouter(prefix="/api")


def _success(data: Any = None, message: str | None = None) -> dict:
    payload: dict[str, Any] = {"success": True}
    if data is not None:
        payload["data"] = data
    if message:
        payload["message"] = message
    return payload


def _error(message: str, status_code: int = 400) -> HTTPException:
    return HTTPException(status_code=status_code, detail=message)


def _silent_audio() -> Response:
    return Response(SILENT_MP3, media_type="audio/mpeg", headers={"Content-Length": str(len(SILENT_MP3))})


@dataclass
class LegadoServices:
    settings: Settings
    client: LegadoApiClient
    audio_cache: PrefetchAudioCache
    book_cache: BookCacheService
    progress: BookCacheProgressStore
    prefetch: DoubaoPrefetchManager


_services_lock = threading.RLock()
_services_by_root: dict[str, LegadoServices] = {}


def get_legado_services() -> LegadoServices:
    settings = get_settings()
    key = str(settings.doubao_data_dir.resolve())
    with _services_lock:
        services = _services_by_root.get(key)
        if services is None:
            client = LegadoApiClient(timeout_seconds=settings.legado_timeout_seconds)
            audio_cache = PrefetchAudioCache(settings.doubao_data_dir)
            book_cache = BookCacheService(
                settings.doubao_data_dir,
                client,
                concurrency=settings.book_cache_concurrency,
            )
            services = LegadoServices(
                settings=settings,
                client=client,
                audio_cache=audio_cache,
                book_cache=book_cache,
                progress=BookCacheProgressStore(),
                prefetch=DoubaoPrefetchManager(
                    audio_cache,
                    book_cache,
                    client,
                    lambda: DoubaoWebAdapter(settings),
                    request_interval_seconds=settings.doubao_request_interval_delay_seconds,
                ),
            )
            _services_by_root[key] = services
        return services


def reset_legado_services() -> None:
    with _services_lock:
        _services_by_root.clear()


@router.get("/legado/tts-config")
def legado_tts_config(
    request: Request,
    voiceId: str | None = None,
    delay: int | None = Query(default=None, ge=0, le=60),
    engineName: str = "豆包TTS",
    contentType: str = "audio/mpeg",
    enableCookie: str = "false",
) -> dict:
    if not voiceId:
        raise _error("缺少voiceId参数")
    configured_delay = DoubaoLegacyConfig(get_settings().doubao_data_dir).get_item("tts.requestDelay", 15)
    effective_delay = int(configured_delay) if delay is None else delay
    base_url = str(request.base_url).rstrip("/")
    stream_url = (
        f"{base_url}/api/reader/tts/stream?text={{{{java.encodeURI(speakText)}}}}"
        f"&speed={{{{speakSpeed}}}}&voice={voiceId}&usePrefetch=false&delay={effective_delay}"
    )
    import time

    timestamp = int(time.time() * 1000)
    return {
        "id": timestamp,
        "name": engineName,
        "url": stream_url,
        "contentType": contentType,
        "concurrentRate": "1",
        "enabledCookieJar": enableCookie == "true",
        "header": "",
        "loginUrl": "",
        "loginUi": "",
        "loginCheckJs": "",
        "lastUpdateTime": timestamp,
    }


@router.get("/legado/tts-config-prefab")
def legado_tts_config_prefab(request: Request, engineName: str = "DoBao-预制模式") -> dict:
    import time

    timestamp = int(time.time() * 1000)
    base_url = str(request.base_url).rstrip("/")
    return {
        "id": timestamp,
        "name": engineName,
        "url": f"{base_url}/api/reader/tts/stream-prefetch?text={{{{java.encodeURI(speakText)}}}}",
        "contentType": "audio/mpeg",
        "concurrentRate": "1",
        "enabledCookieJar": False,
        "header": "",
        "loginUrl": "",
        "loginUi": "",
        "loginCheckJs": "",
        "lastUpdateTime": timestamp,
    }


def _cached_audio_response(text: str, *, book_id: str | None = None, chapter_id: str | None = None) -> FileResponse | None:
    result = get_legado_services().audio_cache.find_audio_by_text(text, book_id, chapter_id)
    if not result:
        return None
    path = Path(result["audioPath"])
    if not path.is_file() or path.stat().st_size <= 0:
        return None
    return FileResponse(path, media_type="audio/mpeg", headers={"Content-Length": str(path.stat().st_size)})


@router.get("/reader/tts/stream")
def legado_tts_stream(
    text: str | None = None,
    voice: str | None = None,
    speed: int = Query(default=0, ge=-50, le=100),
    usePrefetch: str = "false",
    delay: int | None = Query(default=None, ge=0, le=60),
) -> Response:
    if not text:
        return _silent_audio()
    if usePrefetch == "true":
        return _cached_audio_response(text) or _silent_audio()
    services = get_legado_services()
    output_path = services.settings.output_dir / "reader" / f"{safe_cache_id(text + str(threading.get_ident()))}.mp3"
    configured_round_delay = DoubaoLegacyConfig(services.settings.doubao_data_dir).get_item("tts.requestDelay", 15)
    effective_round_delay = configured_round_delay if delay is None else delay
    try:
        DoubaoWebAdapter(services.settings).synthesize_to_path(
            text=text,
            voice_id=voice or DEFAULT_DOUBAO_VOICE,
            output_path=output_path,
            output_format="mp3",
            speech_rate=speed,
            request_delay_seconds=float(effective_round_delay),
            request_interval_seconds=services.settings.doubao_request_interval_delay_seconds,
        )
        return FileResponse(output_path, media_type="audio/mpeg", headers={"Content-Length": str(output_path.stat().st_size)})
    except Exception:
        return _silent_audio()


@router.get("/reader/tts/stream-prefetch")
def legado_tts_stream_prefetch(text: str | None = None) -> Response:
    if not text:
        return _silent_audio()
    try:
        return _cached_audio_response(text) or _silent_audio()
    except Exception:
        return _silent_audio()


@router.post("/legado/proxy/bookshelf")
def proxy_bookshelf(payload: dict = Body(...)) -> dict:
    server_ip, server_port = payload.get("serverIp"), payload.get("serverPort")
    if not server_ip or not server_port:
        raise _error("缺少必需参数：serverIp 和 serverPort")
    services = get_legado_services()
    try:
        books = unwrap_list(services.client.get_bookshelf(str(server_ip), int(server_port)))
        for book in books:
            try:
                book["totalChapters"] = len(
                    unwrap_list(services.client.get_chapter_list(str(server_ip), int(server_port), str(book.get("bookUrl") or "")))
                )
            except Exception:
                book["totalChapters"] = int(book.get("durChapterIndex") or -1) + 1
        return _success(books, "获取书架列表成功")
    except Exception as exc:
        raise _error(str(exc) or "连接失败，请检查服务器地址和端口是否正确", 500) from exc


@router.post("/legado/proxy/chapters")
def proxy_chapters(payload: dict = Body(...)) -> dict:
    if not payload.get("serverIp") or not payload.get("serverPort"):
        raise _error("缺少必需参数：serverIp 和 serverPort")
    if not payload.get("bookUrl"):
        raise _error("缺少必需参数：bookUrl")
    try:
        chapters = unwrap_list(
            get_legado_services().client.get_chapter_list(
                str(payload["serverIp"]), int(payload["serverPort"]), str(payload["bookUrl"])
            )
        )
        return _success(chapters, "获取章节列表成功")
    except Exception as exc:
        raise _error(str(exc), 500) from exc


@router.post("/legado/proxy/content")
def proxy_content(payload: dict = Body(...)) -> dict:
    if not payload.get("serverIp") or not payload.get("serverPort"):
        raise _error("缺少必需参数：serverIp 和 serverPort")
    if not payload.get("bookUrl"):
        raise _error("缺少必需参数：bookUrl")
    if payload.get("chapterIndex") is None:
        raise _error("缺少必需参数：chapterIndex")
    try:
        content = get_legado_services().client.get_chapter_content(
            str(payload["serverIp"]), int(payload["serverPort"]), str(payload["bookUrl"]), int(payload["chapterIndex"])
        )
        return _success(content, "获取章节内容成功")
    except Exception as exc:
        raise _error(str(exc), 500) from exc


@router.get("/legado/proxy/cover")
def proxy_cover(serverIp: str, serverPort: int, coverPath: str) -> Response:
    try:
        content, content_type = get_legado_services().client.get_cover(serverIp, serverPort, coverPath)
        return Response(content, media_type=content_type)
    except Exception as exc:
        raise _error(str(exc), 500) from exc


def _validate_prefetch_payload(payload: dict, *, batch: bool) -> tuple[dict, list[dict], dict]:
    book_info = payload.get("bookInfo")
    options = payload.get("options")
    chapters = payload.get("chaptersInfo") if batch else [payload.get("chapterInfo")]
    if not isinstance(book_info, dict) or not isinstance(options, dict) or not chapters or not all(isinstance(item, dict) for item in chapters):
        label = "chaptersInfo" if batch else "chapterInfo"
        raise _error(f"缺少必需参数：bookInfo、{label} 或 options")
    if not all(book_info.get(field) for field in ("bookId", "bookName", "bookUrl")):
        raise _error("bookInfo 缺少必需字段")
    if not options.get("voiceId"):
        raise _error("options 缺少必需字段: voiceId")
    for position, chapter in enumerate(chapters, start=1):
        required = chapter.get("chapterId") and (chapter.get("chapterTitle") or chapter.get("title"))
        index = chapter.get("chapterIndex", chapter.get("index"))
        if not required or index is None or (not batch and not chapter.get("chapterUrl") and not chapter.get("content")):
            raise _error(f"第 {position} 个章节缺少必需字段" if batch else "chapterInfo 缺少必需字段")
    return book_info, chapters, options


@router.post("/legado/prefetch/start")
def prefetch_start(payload: dict = Body(...)) -> dict:
    book_info, chapters, options = _validate_prefetch_payload(payload, batch=False)
    task = get_legado_services().prefetch.start(book_info, chapters[0], options)
    return _success(
        {"taskId": task["taskId"], "status": "processing", "progress": {"total": 0, "completed": 0, "failed": 0}},
        "任务已启动",
    )


@router.post("/legado/prefetch/batch-start")
def prefetch_batch_start(payload: dict = Body(...)) -> dict:
    book_info, chapters, options = _validate_prefetch_payload(payload, batch=True)
    task = get_legado_services().prefetch.batch_start(book_info, chapters, options)
    return _success(
        {
            "taskId": task["taskId"],
            "status": "processing",
            "progress": {"total": len(chapters), "completed": 0, "failed": 0},
        },
        f"批量任务已启动，共 {len(chapters)} 个章节",
    )


def _public_task_status(task: dict) -> dict:
    chapters = task.get("chapters") or []
    if chapters:
        progress = {
            "completed": sum(chapter.get("status") == "completed" for chapter in chapters),
            "total": len(chapters),
            "failed": sum(chapter.get("status") == "failed" for chapter in chapters),
        }
    else:
        raw = task.get("progress") or {}
        progress = {
            "completed": int(raw.get("current") or 0),
            "total": int(raw.get("total") or 0),
            "failed": len(raw.get("failed") or []),
        }
    return {
        "taskId": task["taskId"],
        "status": task.get("status"),
        "progress": progress,
        "currentSegment": int(task.get("progress", {}).get("current") or 0),
        "chapters": [
            {
                key: chapter.get(key)
                for key in ("chapterId", "chapterTitle", "status", "completedSegments", "totalSegments", "error")
            }
            for chapter in chapters
        ]
        or None,
        "startTime": task.get("createdAt"),
        "estimatedTimeRemaining": None,
    }


@router.get("/legado/prefetch/status/{task_id}")
def prefetch_status(task_id: str, bookId: str | None = None, chapterId: str | None = None) -> dict:
    services = get_legado_services()
    task = services.prefetch.get(task_id)
    if task:
        return _success(_public_task_status(task))
    if bookId and chapterId:
        index = services.audio_cache.load_chapter_index(bookId, chapterId)
        if index:
            metadata = index.get("metadata", {})
            return _success(
                {
                    "taskId": task_id,
                    "status": metadata.get("status"),
                    "progress": {
                        "total": metadata.get("totalSegments", 0),
                        "completed": metadata.get("completedSegments", 0),
                        "failed": metadata.get("totalSegments", 0) - metadata.get("completedSegments", 0),
                    },
                    "currentSegment": metadata.get("completedSegments", 0),
                    "startTime": metadata.get("createdAt"),
                    "estimatedTimeRemaining": None,
                }
            )
    raise _error("任务不存在", 404)


@router.post("/legado/prefetch/pause/{task_id}")
def prefetch_pause(task_id: str) -> dict:
    try:
        get_legado_services().prefetch.pause(task_id)
    except KeyError as exc:
        raise _error(f"任务不存在: {task_id}", 404) from exc
    return _success(message="任务已暂停")


@router.post("/legado/prefetch/resume/{task_id}")
def prefetch_resume(task_id: str) -> dict:
    try:
        get_legado_services().prefetch.resume(task_id)
    except KeyError as exc:
        raise _error(f"任务不存在: {task_id}", 404) from exc
    return _success(message="任务已恢复")


@router.post("/legado/prefetch/cancel/{task_id}")
def prefetch_cancel(task_id: str) -> dict:
    try:
        result = get_legado_services().prefetch.cancel(task_id)
    except KeyError as exc:
        raise _error(f"任务不存在: {task_id}", 404) from exc
    if result["alreadyFinished"]:
        return _success(result, f"任务已经{result['status']}")
    return _success(message="任务已停止，已预制内容已保留")


@router.delete("/legado/prefetch/files/{task_id}")
def prefetch_delete_files(task_id: str) -> dict:
    if not get_legado_services().prefetch.delete_task_files(task_id):
        raise _error("任务不存在", 404)
    return _success(message="任务文件已清理")


@router.post("/legado/prefetch/retry/{task_id}")
def prefetch_retry(task_id: str, payload: dict = Body(default_factory=dict)) -> dict:
    try:
        result = get_legado_services().prefetch.retry(task_id, payload.get("chapterId"))
    except KeyError as exc:
        raise _error(f"任务不存在: {task_id}", 404) from exc
    return _success({"retried": result}, "任务重试已启动" if result else "没有需要重试的任务")


@router.get("/legado/prefetch/tasks")
def prefetch_tasks() -> dict:
    return _success(get_legado_services().prefetch.list(), "获取任务列表成功")


@router.delete("/legado/prefetch/tasks/{task_id}")
def prefetch_delete_task(task_id: str) -> dict:
    if not get_legado_services().prefetch.delete_task(task_id):
        raise _error("任务不存在或删除失败", 404)
    return _success(message="任务已删除")


@router.delete("/legado/prefetch/book/{book_id}")
def prefetch_delete_book(book_id: str, keepCache: str = "false") -> dict:
    services = get_legado_services()
    deleted_tasks = services.prefetch.delete_tasks_by_book(book_id)
    cache_deleted = False if keepCache == "true" else services.audio_cache.delete_book(book_id)
    return _success(
        {"deletedTaskCount": deleted_tasks, "cacheDeleted": cache_deleted},
        f"已删除《{book_id}》的{deleted_tasks}个任务" + ("（保留缓存）" if keepCache == "true" else ""),
    )


@router.get("/legado/prefetch/cache/{book_id}/{chapter_id}")
def prefetch_cache_status(book_id: str, chapter_id: str) -> dict:
    index = get_legado_services().audio_cache.load_chapter_index(book_id, chapter_id)
    return _success({"exists": bool(index), "index": index})


@router.post("/legado/prefetch/chapters-status/{book_id}")
def prefetch_chapters_status(book_id: str, payload: dict = Body(...)) -> dict:
    chapters = payload.get("chapters")
    if not isinstance(chapters, list) or not chapters:
        raise _error("缺少必需参数：chapters（章节信息数组）")
    services = get_legado_services()
    statuses: dict[str, bool] = {}
    for chapter in chapters:
        chapter_id = str(chapter.get("index"))
        if chapter.get("url"):
            parsed = urlsplit(str(chapter["url"]))
            chapter_id = parsed.path if parsed.scheme and parsed.path else str(chapter["url"])
        index = services.audio_cache.load_chapter_index(book_id, chapter_id)
        statuses[str(chapter.get("index"))] = bool(index and index.get("metadata", {}).get("status") == "completed")
    completed = sum(statuses.values())
    return _success(
        {"bookId": book_id, "chapterStatus": statuses, "completedCount": completed, "totalCount": len(chapters)},
        f"查询完成，{completed}/{len(chapters)} 个章节已完成预制",
    )


@router.delete("/legado/prefetch/chapter/{book_id}/{chapter_id}")
def prefetch_delete_chapter(book_id: str, chapter_id: str) -> dict:
    if not get_legado_services().audio_cache.delete_chapter(book_id, chapter_id):
        raise _error("未找到该章节的预制音频", 404)
    return _success({"bookId": book_id, "chapterId": chapter_id}, "章节预制音频已删除")


@router.get("/legado/prefetch/audio")
def prefetch_audio(text: str, bookId: str | None = None, chapterId: str | None = None) -> FileResponse:
    response = _cached_audio_response(text, book_id=bookId, chapter_id=chapterId)
    if not response:
        raise _error("未找到预制音频", 404)
    return response


@router.post("/legado/book-cache/start")
def book_cache_start(payload: dict = Body(...)) -> dict:
    book_info = payload.get("bookInfo")
    server_ip, server_port = payload.get("serverIp"), payload.get("serverPort")
    if not isinstance(book_info, dict) or not book_info.get("bookUrl") or not (book_info.get("name") or book_info.get("bookName")):
        raise _error("缺少必需参数：bookInfo（包含bookUrl和name）")
    if not server_ip or not server_port:
        raise _error("缺少必需参数：serverIp 和 serverPort")
    services = get_legado_services()
    book_url = str(book_info["bookUrl"])
    try:
        result = services.book_cache.cache_book(
            book_info,
            str(server_ip),
            int(server_port),
            lambda progress: services.progress.update(book_url, progress),
        )
        services.progress.update(book_url, {**result, "status": result["status"], "percent": 100})
        if result["skippedChapters"]:
            message = (
                f"书籍缓存完成，跳过 {result['skippedChapters']} 个已缓存章节，"
                f"新缓存 {result['newCachedChapters']}/{result['totalChapters']} 个章节"
            )
        else:
            message = f"书籍缓存完成，共缓存 {result['cachedChapters']}/{result['totalChapters']} 个章节"
        return _success(result, message)
    except Exception as exc:
        services.progress.update(book_url, {"status": "error", "error": str(exc)})
        raise _error(str(exc), 500) from exc


@router.get("/legado/book-cache/progress")
def book_cache_progress(bookUrl: str) -> StreamingResponse:
    progress_store = get_legado_services().progress

    def events() -> Iterator[str]:
        previous = None
        while True:
            current = progress_store.get(bookUrl)
            if current != previous:
                previous = current
                yield f"data: {json.dumps(current or {}, ensure_ascii=False)}\n\n"
            if current and current.get("status") in {"completed", "partial", "cancelled", "error"}:
                return
            changed = progress_store.wait_for_change(bookUrl, previous, timeout=15)
            if changed == previous:
                yield ": keep-alive\n\n"

    return StreamingResponse(
        events(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive", "X-Accel-Buffering": "no"},
    )


@router.post("/legado/book-cache/clear-progress")
def book_cache_clear_progress(payload: dict = Body(...)) -> dict:
    if not payload.get("bookUrl"):
        raise _error("缺少必需参数：bookUrl")
    get_legado_services().progress.clear(str(payload["bookUrl"]))
    return _success(message="进度数据已清除")


@router.post("/legado/book-cache/cancel")
def book_cache_cancel(payload: dict = Body(...)) -> dict:
    book_url = payload.get("bookUrl")
    if not book_url:
        raise _error("缺少必需参数：bookUrl")
    services = get_legado_services()
    info = services.book_cache.get_info(str(book_url))
    if not info or info.get("status") != "caching":
        return _success(
            {"alreadyFinished": True, "status": (info or {}).get("status", "unknown")},
            "书籍不在缓存中，无需取消",
        )
    services.book_cache.cancel(str(book_url))
    services.progress.update(str(book_url), {"status": "cancelling"})
    return _success({"alreadyFinished": False, "status": "cancelling"}, "已发送取消请求，当前章节缓存完成后将停止")


@router.get("/legado/book-cache/status")
def book_cache_status(bookUrl: str) -> dict:
    services = get_legado_services()
    info = services.book_cache.get_info(bookUrl)
    return _success(
        {"isCached": bool(info), "cacheInfo": info},
        "书籍已缓存" if info else "书籍未缓存",
    )


@router.get("/legado/book-cache/list")
def book_cache_list(source: str | None = None) -> dict:
    services = get_legado_services()
    books = []
    if source in (None, "cache"):
        books.extend(services.book_cache.list_books())
    if source in (None, "prefetch"):
        books.extend(services.audio_cache.list_books())
    return _success(books, f"获取到 {len(books)} 个书籍")


@router.get("/legado/book-cache/cover/{book_id}")
def book_cache_cover(book_id: str) -> FileResponse:
    path = get_legado_services().book_cache.cover_path(book_id)
    if not path.is_file():
        raise _error("封面不存在", 404)
    return FileResponse(path, media_type="image/jpeg", headers={"Cache-Control": "public, max-age=86400"})


@router.get("/legado/book-cache/chapters")
def book_cache_chapters(bookUrl: str, source: str | None = None) -> dict:
    services = get_legado_services()
    chapters = services.book_cache.list_chapters(bookUrl) if source in (None, "cache") else []
    if not chapters and source in (None, "prefetch"):
        chapters = services.audio_cache.list_chapters(bookUrl)
    return _success(chapters, f"获取到 {len(chapters)} 个章节")


@router.delete("/legado/book-cache/delete")
def book_cache_delete(bookUrl: str) -> dict:
    services = get_legado_services()
    deleted = services.book_cache.delete_book(bookUrl)
    prefetch_deleted = services.audio_cache.delete_book(bookUrl)
    if not deleted and not prefetch_deleted:
        raise _error("书籍缓存不存在或删除失败", 404)
    return _success(message="书籍缓存已删除")


@router.get("/legado/book-id/generate")
def book_id_generate(bookUrl: str) -> dict:
    return _success({"bookId": safe_cache_id(bookUrl), "bookUrl": bookUrl}, "生成成功")


@router.delete("/legado/book-cache/clear")
def book_cache_clear(type: str = Query(default="all", pattern="^(cache|prefetch|all)$")) -> dict:
    services = get_legado_services()
    cache_count = services.book_cache.clear() if type in {"cache", "all"} else 0
    prefetch_count = 0
    if type in {"prefetch", "all"}:
        services.prefetch.clear()
        prefetch_count = services.audio_cache.clear_books()
    total = cache_count + prefetch_count
    if type == "cache":
        message = f"已清空 {cache_count} 本书籍的缓存"
    elif type == "prefetch":
        message = f"已清空 {prefetch_count} 本书籍的预制数据"
    else:
        message = f"已清空 {total} 本书籍的缓存和预制数据"
    return _success(
        {"cacheDeletedCount": cache_count, "prefetchDeletedCount": prefetch_count, "totalDeletedCount": total},
        message,
    )


@router.get("/legado/book-cache/stats")
def book_cache_stats() -> dict:
    return _success(get_legado_services().book_cache.stats(), "获取缓存统计信息成功")


@router.get("/legado/book-cache/chapter")
def book_cache_chapter(bookUrl: str, chapterIndex: int) -> dict:
    chapter = get_legado_services().book_cache.get_chapter(bookUrl, chapterIndex)
    if not chapter:
        raise _error("章节未缓存", 404)
    return _success(chapter, "获取缓存章节成功")
