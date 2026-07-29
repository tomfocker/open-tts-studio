from __future__ import annotations

import base64
import hashlib
import json
import re
import shutil
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Iterator

import httpx

from tts_api.legado_client import LegadoApiClient, unwrap_content, unwrap_list


SILENT_MP3 = base64.b64decode(
    "SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4Ljc2LjEwMAAAAAAAAAAAAAAA//tQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWGluZwAAAA8AAAACAAADhAC7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7//////////////////////////////////////////////////////////////////8AAAAATGF2YzU4LjEzAAAAAAAAAAAAAAAAJAAAAAAAAAAAA4Qvw1l8AAAAAAD/+xDEAAP8AFQCOEEBAYDBh/iAAABCJ3AXPwAAAmP/wgIhB4GAYCBgICAgICAgICAgICAgICAgICAgICAgIA//sQxCkD/AAhP+YAAAlwAKn/4AAAH/wICAgICAgICAgICAgICAgICAgICAgICAgICAgICA"
)


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def safe_cache_id(value: Any) -> str:
    text = str(value or "")
    if re.fullmatch(r"[a-fA-F0-9]{16}", text):
        return text.lower()
    if not text:
        return "unknown"
    return hashlib.md5(text.encode("utf-8"), usedforsecurity=False).hexdigest()[:16]


def split_text_by_newline(text: str) -> list[str]:
    normalized = str(text or "").replace("\r\n", "\n").replace("\r", "\n")
    return [line.strip() for line in normalized.split("\n") if line.strip()]


def normalize_lookup_text(text: str) -> str:
    return "".join(re.findall(r"[\u4e00-\u9fffa-zA-Z0-9]", str(text or ""))).lower()


def _lcs_score(left: str, right: str) -> float:
    if not left or not right:
        return 0.0
    if left == right:
        return 1.0
    # Reading requests are normally one paragraph. Keep pathological external
    # requests from turning a compatibility endpoint into an unbounded DP job.
    if len(left) > 2000 or len(right) > 2000:
        shorter, longer = sorted((left, right), key=len)
        return len(shorter) / len(longer) if shorter in longer else 0.0
    if len(left) > len(right):
        left, right = right, left
    previous = [0] * (len(left) + 1)
    for right_character in right:
        current = [0]
        for index, left_character in enumerate(left, start=1):
            if left_character == right_character:
                current.append(previous[index - 1] + 1)
            else:
                current.append(max(previous[index], current[-1]))
        previous = current
    return previous[-1] / max(len(left), len(right))


def _read_json(path: Path, default: Any = None) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError, TypeError):
        return default


def _write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{threading.get_ident()}.tmp")
    temporary.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    temporary.replace(path)


class PrefetchAudioCache:
    def __init__(self, data_dir: Path):
        self.base_dir = Path(data_dir) / "prefetch"
        self.books_dir = self.base_dir / "books"
        self.tasks_dir = self.base_dir / "tasks"
        self.books_dir.mkdir(parents=True, exist_ok=True)
        self.tasks_dir.mkdir(parents=True, exist_ok=True)
        self._index_cache: dict[Path, tuple[int, dict]] = {}
        self._lock = threading.RLock()
        self._metrics = {
            "cacheHits": 0,
            "cacheMisses": 0,
            "totalQueries": 0,
            "indexLoads": 0,
            "indexCacheHits": 0,
            "indexCacheMisses": 0,
            "lastReset": utc_now_iso(),
        }

    def chapter_dir(self, book_id: str, chapter_id: str) -> Path:
        return self.books_dir / safe_cache_id(book_id) / "chapters" / safe_cache_id(chapter_id)

    def index_path(self, book_id: str, chapter_id: str) -> Path:
        return self.chapter_dir(book_id, chapter_id) / "index.json"

    def load_chapter_index(self, book_id: str, chapter_id: str) -> dict | None:
        path = self.index_path(book_id, chapter_id)
        try:
            modified = path.stat().st_mtime_ns
        except OSError:
            return None
        with self._lock:
            self._metrics["indexLoads"] += 1
            cached = self._index_cache.get(path)
            if cached and cached[0] == modified:
                self._metrics["indexCacheHits"] += 1
                return cached[1]
            self._metrics["indexCacheMisses"] += 1
            payload = _read_json(path)
            if not isinstance(payload, dict):
                return None
            self._index_cache[path] = (modified, payload)
            return payload

    def save_chapter_index(self, book_id: str, chapter_id: str, payload: dict) -> Path:
        path = self.index_path(book_id, chapter_id)
        with self._lock:
            _write_json(path, payload)
            self._index_cache.pop(path, None)
        return path

    def _iter_indexes(self, book_id: str | None = None, chapter_id: str | None = None) -> Iterator[tuple[str, str, Path]]:
        if book_id and chapter_id:
            path = self.index_path(book_id, chapter_id)
            if path.exists():
                yield safe_cache_id(book_id), safe_cache_id(chapter_id), path
            return
        roots = [self.books_dir / safe_cache_id(book_id)] if book_id else list(self.books_dir.iterdir())
        for book_dir in roots:
            chapters_dir = book_dir / "chapters"
            if not chapters_dir.is_dir():
                continue
            if chapter_id:
                chapter_dirs = [chapters_dir / safe_cache_id(chapter_id)]
            else:
                chapter_dirs = [path for path in chapters_dir.iterdir() if path.is_dir()]
            for chapter_dir in chapter_dirs:
                path = chapter_dir / "index.json"
                if path.is_file():
                    yield book_dir.name, chapter_dir.name, path

    def find_audio_by_text(
        self,
        text: str,
        book_id: str | None = None,
        chapter_id: str | None = None,
    ) -> dict | None:
        if not str(text or "").strip():
            raise ValueError("文本参数不能为空")
        normalized = normalize_lookup_text(text)
        threshold = 0.7 if book_id else 0.6
        best: dict | None = None
        with self._lock:
            self._metrics["totalQueries"] += 1
        for safe_book_id, safe_chapter_id, index_path in self._iter_indexes(book_id, chapter_id):
            payload = self.load_chapter_index(safe_book_id, safe_chapter_id)
            if not payload:
                continue
            for segment in payload.get("segments", []):
                if not isinstance(segment, dict):
                    continue
                score = _lcs_score(normalized, normalize_lookup_text(str(segment.get("text") or "")))
                if score <= threshold or best and score <= best["score"]:
                    continue
                audio_file = segment.get("audioFile") or f"audio/{segment.get('segmentId', '')}.mp3"
                audio_path = index_path.parent / str(audio_file)
                if not audio_path.is_file() or audio_path.stat().st_size <= 0:
                    continue
                best = {
                    "bookId": payload.get("bookId") or safe_book_id,
                    "chapterId": payload.get("chapterId") or safe_chapter_id,
                    "segmentId": segment.get("segmentId"),
                    "audioPath": str(audio_path.resolve()),
                    "text": segment.get("text") or "",
                    "score": score,
                }
                if score == 1.0:
                    break
            if best and best["score"] == 1.0:
                break
        with self._lock:
            self._metrics["cacheHits" if best else "cacheMisses"] += 1
        return best

    def delete_chapter(self, book_id: str, chapter_id: str) -> bool:
        path = self.chapter_dir(book_id, chapter_id)
        if not path.exists():
            return False
        shutil.rmtree(path)
        with self._lock:
            self._index_cache.clear()
        return True

    def delete_book(self, book_id: str) -> bool:
        path = self.books_dir / safe_cache_id(book_id)
        if not path.exists():
            return False
        shutil.rmtree(path)
        with self._lock:
            self._index_cache.clear()
        return True

    def clear_books(self) -> int:
        directories = [path for path in self.books_dir.iterdir() if path.is_dir()]
        for path in directories:
            shutil.rmtree(path)
        with self._lock:
            self._index_cache.clear()
        return len(directories)

    def list_books(self) -> list[dict]:
        books: list[dict] = []
        for book_dir in self.books_dir.iterdir():
            chapters_dir = book_dir / "chapters"
            if not chapters_dir.is_dir():
                continue
            chapter_list = []
            book_name = book_dir.name
            original_book_id = book_dir.name
            for chapter_dir in chapters_dir.iterdir():
                payload = _read_json(chapter_dir / "index.json")
                if not isinstance(payload, dict):
                    continue
                book_name = str(payload.get("bookName") or book_name)
                original_book_id = str(payload.get("bookId") or original_book_id)
                chapter_list.append(
                    {
                        "index": payload.get("chapterIndex", len(chapter_list)),
                        "title": payload.get("chapterTitle") or f"第{len(chapter_list) + 1}章",
                        "url": payload.get("chapterUrl") or "",
                        "chapterId": payload.get("chapterId") or chapter_dir.name,
                    }
                )
            if chapter_list:
                chapter_list.sort(key=lambda item: int(item.get("index") or 0))
                books.append(
                    {
                        "bookId": original_book_id,
                        "bookUrl": original_book_id,
                        "name": book_name,
                        "totalChapters": len(chapter_list),
                        "cachedChapters": len(chapter_list),
                        "chapterList": chapter_list,
                        "cachedAt": datetime.fromtimestamp(book_dir.stat().st_ctime, timezone.utc).isoformat(),
                        "source": "prefetch",
                    }
                )
        return books

    def list_chapters(self, book_id: str) -> list[dict]:
        safe_book = self.books_dir / safe_cache_id(book_id) / "chapters"
        if not safe_book.is_dir():
            return []
        chapters = []
        for chapter_dir in safe_book.iterdir():
            payload = _read_json(chapter_dir / "index.json")
            if not isinstance(payload, dict):
                continue
            chapters.append(
                {
                    "index": payload.get("chapterIndex", len(chapters)),
                    "title": payload.get("chapterTitle") or f"第{len(chapters) + 1}章",
                    "url": payload.get("chapterUrl") or "",
                    "chapterId": payload.get("chapterId") or chapter_dir.name,
                }
            )
        chapters.sort(key=lambda item: int(item.get("index") or 0))
        return chapters

    def metrics(self) -> dict:
        with self._lock:
            result = dict(self._metrics)
        result["hitRate"] = round(result["cacheHits"] / result["totalQueries"] * 100, 2) if result["totalQueries"] else 0.0
        result["indexCacheHitRate"] = round(result["indexCacheHits"] / result["indexLoads"] * 100, 2) if result["indexLoads"] else 0.0
        return result


class BookCacheService:
    def __init__(
        self,
        data_dir: Path,
        legado_client: LegadoApiClient,
        *,
        concurrency: int = 20,
    ):
        self.base_dir = Path(data_dir) / "book-cache"
        self.books_dir = self.base_dir / "books"
        self.covers_dir = self.base_dir / "covers"
        self.index_file = self.base_dir / "cache-index.json"
        self.legado_client = legado_client
        self.concurrency = max(1, min(int(concurrency), 50))
        self._lock = threading.RLock()
        self._cancelled: set[str] = set()
        self.books_dir.mkdir(parents=True, exist_ok=True)
        self.covers_dir.mkdir(parents=True, exist_ok=True)
        payload = _read_json(self.index_file, {})
        self._index: dict[str, dict] = payload if isinstance(payload, dict) else {}

    def _save_index(self) -> None:
        with self._lock:
            _write_json(self.index_file, self._index)

    def generate_book_id(self, book_url: str) -> str:
        return safe_cache_id(book_url)

    def book_dir(self, book_url: str) -> Path:
        return self.books_dir / self.generate_book_id(book_url)

    def chapter_path(self, book_url: str, chapter_index: int) -> Path:
        return self.book_dir(book_url) / f"chapter_{int(chapter_index)}.json"

    def cover_path(self, book_id: str) -> Path:
        return self.covers_dir / f"{safe_cache_id(book_id)}.jpg"

    def get_info(self, book_url: str) -> dict | None:
        with self._lock:
            record = self._index.get(self.generate_book_id(book_url))
            return dict(record) if record else None

    def is_book_cached(self, book_url: str) -> bool:
        return self.get_info(book_url) is not None

    def get_chapter(self, book_url: str, chapter_index: int) -> dict | None:
        payload = _read_json(self.chapter_path(book_url, chapter_index))
        return payload if isinstance(payload, dict) else None

    def list_chapters(self, book_url: str) -> list[dict]:
        directory = self.book_dir(book_url)
        if not directory.is_dir():
            return []
        chapters = []
        for path in directory.glob("chapter_*.json"):
            try:
                index = int(path.stem.removeprefix("chapter_"))
            except ValueError:
                continue
            payload = _read_json(path, {})
            chapters.append(
                {
                    "index": index,
                    "title": payload.get("title") or f"第{index + 1}章",
                    "url": payload.get("url") or "",
                }
            )
        chapters.sort(key=lambda item: item["index"])
        return chapters

    def list_books(self) -> list[dict]:
        with self._lock:
            records = [dict(record) for record in self._index.values()]
        for record in records:
            record["source"] = "cache"
            if record.get("coverCached"):
                record["coverUrl"] = f"/api/legado/book-cache/cover/{record['bookId']}"
            if not record.get("chapterList"):
                record["chapterList"] = self.list_chapters(str(record.get("bookUrl") or record.get("bookId")))
        return [record for record in records if int(record.get("cachedChapters") or 0) > 0]

    def cancel(self, book_url: str) -> None:
        with self._lock:
            self._cancelled.add(book_url)

    def _is_cancelled(self, book_url: str) -> bool:
        with self._lock:
            return book_url in self._cancelled

    def _cache_cover(self, book_id: str, cover_url: str, server_ip: str, server_port: int) -> bool:
        if not cover_url:
            return False
        path = self.cover_path(book_id)
        if path.is_file() and path.stat().st_size:
            return True
        try:
            if cover_url.startswith("http://") or cover_url.startswith("https://"):
                response = httpx.get(cover_url, timeout=10, follow_redirects=True)
                response.raise_for_status()
                content = response.content
            elif cover_url.startswith("/"):
                content, _content_type = self.legado_client.get_cover(server_ip, server_port, cover_url)
            else:
                return False
            if not content:
                return False
            path.write_bytes(content)
            return True
        except (OSError, httpx.HTTPError, RuntimeError):
            return False

    def cache_book(
        self,
        book_info: dict,
        server_ip: str,
        server_port: int,
        progress_callback: Callable[[dict], None] | None = None,
    ) -> dict:
        from concurrent.futures import ThreadPoolExecutor, as_completed

        book_url = str(book_info.get("bookUrl") or "")
        book_name = str(book_info.get("name") or book_info.get("bookName") or "")
        if not book_url or not book_name:
            raise ValueError("bookInfo 必须包含 bookUrl 和 name")
        with self._lock:
            self._cancelled.discard(book_url)
        book_id = self.generate_book_id(book_url)
        self.book_dir(book_url).mkdir(parents=True, exist_ok=True)
        cover_cached = self._cache_cover(
            book_id,
            str(book_info.get("coverUrl") or book_info.get("cover") or ""),
            server_ip,
            server_port,
        )
        chapters = unwrap_list(self.legado_client.get_chapter_list(server_ip, server_port, book_url))
        if not chapters:
            raise RuntimeError("书籍没有章节")
        normalized_chapters = []
        for position, chapter in enumerate(chapters):
            item = dict(chapter)
            try:
                item["index"] = int(item.get("index", position))
            except (TypeError, ValueError):
                item["index"] = position
            item["title"] = str(item.get("title") or f"第{item['index'] + 1}章")
            normalized_chapters.append(item)
        skipped = [chapter for chapter in normalized_chapters if self.chapter_path(book_url, chapter["index"]).is_file()]
        pending = [chapter for chapter in normalized_chapters if chapter not in skipped]
        record = {
            "bookId": book_id,
            "bookUrl": book_url,
            "name": book_name,
            "author": str(book_info.get("author") or ""),
            "coverUrl": str(book_info.get("coverUrl") or book_info.get("cover") or ""),
            "coverCached": cover_cached,
            "totalChapters": len(normalized_chapters),
            "cachedChapters": len(skipped),
            "newCachedChapters": 0,
            "skippedChapters": len(skipped),
            "failedChapters": 0,
            "cachedAt": utc_now_iso(),
            "updatedAt": utc_now_iso(),
            "serverIp": server_ip,
            "serverPort": int(server_port),
            "chapterList": [
                {"index": chapter["index"], "title": chapter["title"], "url": chapter.get("url", "")}
                for chapter in normalized_chapters
            ],
            "status": "caching",
        }
        with self._lock:
            self._index[book_id] = record
            self._save_index()

        completed: list[dict] = []
        failures: list[dict] = []
        processed = 0
        progress_lock = threading.Lock()

        def report(chapter: str = "", status: str = "processing", error: str | None = None) -> None:
            payload = {
                "current": len(skipped) + processed,
                "total": len(normalized_chapters),
                "toCache": len(pending),
                "cached": len(completed),
                "skipped": len(skipped),
                "failed": len(failures),
                "chapter": chapter,
                "percent": round((len(skipped) + processed) / len(normalized_chapters) * 100),
                "status": status,
                "concurrent": self.concurrency,
            }
            if error:
                payload["error"] = error
            if progress_callback:
                progress_callback(payload)

        report(status="starting")

        def cache_one(chapter: dict) -> dict:
            if self._is_cancelled(book_url):
                return {"status": "cancelled", "chapter": chapter}
            payload = self.legado_client.get_chapter_content(server_ip, server_port, book_url, chapter["index"])
            content = unwrap_content(payload)
            if not content.strip():
                raise RuntimeError("章节内容为空")
            chapter_data = {
                "index": chapter["index"],
                "title": chapter["title"],
                "url": chapter.get("url") or "",
                "content": content,
                "cachedAt": utc_now_iso(),
            }
            _write_json(self.chapter_path(book_url, chapter["index"]), chapter_data)
            return {"status": "success", "chapter": chapter, "data": chapter_data}

        if pending:
            with ThreadPoolExecutor(max_workers=min(self.concurrency, len(pending)), thread_name_prefix="legado-cache") as executor:
                futures = {executor.submit(cache_one, chapter): chapter for chapter in pending}
                for future in as_completed(futures):
                    chapter = futures[future]
                    with progress_lock:
                        processed += 1
                        try:
                            result = future.result()
                            if result["status"] == "success":
                                completed.append(result["data"])
                            elif result["status"] == "cancelled":
                                pass
                        except Exception as exc:
                            failures.append({"index": chapter["index"], "title": chapter["title"], "error": str(exc)})
                            report(chapter["title"], "error", str(exc))
                        else:
                            report(chapter["title"])
                    if self._is_cancelled(book_url):
                        for outstanding in futures:
                            outstanding.cancel()

        status = "cancelled" if self._is_cancelled(book_url) else "completed" if not failures else "partial"
        with self._lock:
            self._cancelled.discard(book_url)
            record.update(
                {
                    "cachedChapters": len(skipped) + len(completed),
                    "newCachedChapters": len(completed),
                    "failedChapters": len(failures),
                    "updatedAt": utc_now_iso(),
                    "status": status,
                }
            )
            self._index[book_id] = record
            self._save_index()
        report(status=status)
        return {
            "success": True,
            "bookId": book_id,
            "totalChapters": len(normalized_chapters),
            "cachedChapters": len(skipped) + len(completed),
            "newCachedChapters": len(completed),
            "skippedChapters": len(skipped),
            "failedChapters": len(failures),
            "failedDetails": failures,
            "coverCached": cover_cached,
            "status": status,
        }

    def delete_book(self, book_url: str) -> bool:
        book_id = self.generate_book_id(book_url)
        existed = self.book_dir(book_url).exists() or book_id in self._index
        shutil.rmtree(self.book_dir(book_url), ignore_errors=True)
        self.cover_path(book_id).unlink(missing_ok=True)
        with self._lock:
            self._index.pop(book_id, None)
            self._save_index()
        return existed

    def clear(self) -> int:
        with self._lock:
            count = len(self._index)
            self._index.clear()
            self._save_index()
        shutil.rmtree(self.books_dir, ignore_errors=True)
        shutil.rmtree(self.covers_dir, ignore_errors=True)
        self.books_dir.mkdir(parents=True, exist_ok=True)
        self.covers_dir.mkdir(parents=True, exist_ok=True)
        return count

    def stats(self) -> dict:
        books = self.list_books()
        total_size = 0
        for path in self.base_dir.rglob("*"):
            if path.is_file():
                try:
                    total_size += path.stat().st_size
                except OSError:
                    pass
        return {
            "totalBooks": len(books),
            "totalChapters": sum(int(book.get("cachedChapters") or 0) for book in books),
            "totalSize": total_size,
            "totalSizeMB": f"{total_size / 1024 / 1024:.2f}",
        }


class BookCacheProgressStore:
    def __init__(self):
        self._items: dict[str, tuple[dict, float]] = {}
        self._condition = threading.Condition()

    def update(self, book_url: str, progress: dict) -> None:
        with self._condition:
            self._items[book_url] = (dict(progress), time.time())
            self._condition.notify_all()

    def get(self, book_url: str) -> dict | None:
        with self._condition:
            item = self._items.get(book_url)
            return dict(item[0]) if item else None

    def clear(self, book_url: str) -> None:
        with self._condition:
            self._items.pop(book_url, None)
            self._condition.notify_all()

    def wait_for_change(self, book_url: str, previous: dict | None, timeout: float = 1.0) -> dict | None:
        with self._condition:
            self._condition.wait_for(
                lambda: self._items.get(book_url, (None, 0))[0] != previous,
                timeout=timeout,
            )
            return self.get(book_url)
