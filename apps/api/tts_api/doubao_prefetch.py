from __future__ import annotations

import threading
import time
from pathlib import Path
from typing import Callable
from uuid import uuid4

from tts_api.adapters.doubao_web import DoubaoWebAdapter
from tts_api.doubao_cache import (
    BookCacheService,
    PrefetchAudioCache,
    _write_json,
    safe_cache_id,
    split_text_by_newline,
    utc_now_iso,
)
from tts_api.legado_client import LegadoApiClient, unwrap_content


class PrefetchPaused(RuntimeError):
    pass


class PrefetchCancelled(RuntimeError):
    pass


class DoubaoPrefetchManager:
    def __init__(
        self,
        audio_cache: PrefetchAudioCache,
        book_cache: BookCacheService,
        legado_client: LegadoApiClient,
        adapter_factory: Callable[[], DoubaoWebAdapter],
        *,
        request_interval_seconds: float = 3.0,
    ):
        self.audio_cache = audio_cache
        self.book_cache = book_cache
        self.legado_client = legado_client
        self.adapter_factory = adapter_factory
        self.request_interval_seconds = max(0.0, min(float(request_interval_seconds), 60.0))
        self._lock = threading.RLock()
        self._tasks: dict[str, dict] = {}
        self._workers: dict[str, threading.Thread] = {}
        self._load_tasks()

    def _load_tasks(self) -> None:
        from tts_api.doubao_cache import _read_json

        for path in self.audio_cache.tasks_dir.glob("*.json"):
            payload = _read_json(path)
            if not isinstance(payload, dict) or not payload.get("taskId"):
                continue
            changed = False
            if payload.get("status") in {"processing", "cancelling"}:
                payload["status"] = "paused"
                changed = True
            for chapter in payload.get("chapters", []):
                if chapter.get("status") == "processing":
                    chapter["status"] = "pending"
                    changed = True
            if changed:
                payload["updatedAt"] = utc_now_iso()
                _write_json(path, payload)
            self._tasks[payload["taskId"]] = payload

    def _task_file(self, task_id: str) -> Path:
        return self.audio_cache.tasks_dir / f"{task_id}.json"

    def _save_task(self, task: dict) -> None:
        with self._lock:
            if self._tasks.get(task["taskId"]) is not task:
                return
            task["updatedAt"] = utc_now_iso()
            _write_json(self._task_file(task["taskId"]), task)

    def _new_task_id(self) -> str:
        return f"task_{int(time.time() * 1000)}_{uuid4().hex[:8]}"

    def start(self, book_info: dict, chapter_info: dict, options: dict) -> dict:
        return self._create_and_start(book_info, [chapter_info], options, single=True)

    def batch_start(self, book_info: dict, chapters_info: list[dict], options: dict) -> dict:
        return self._create_and_start(book_info, chapters_info, options, single=False)

    def _create_and_start(self, book_info: dict, chapters_info: list[dict], options: dict, *, single: bool) -> dict:
        task_id = self._new_task_id()
        now = utc_now_iso()
        task = {
            "taskId": task_id,
            "bookInfo": dict(book_info),
            "chapterInfo": dict(chapters_info[0]) if single else None,
            "chaptersInfo": [dict(chapter) for chapter in chapters_info],
            "options": dict(options),
            "status": "processing",
            "progress": {"current": 0, "total": 0 if single else len(chapters_info), "completed": [], "failed": []},
            "chapters": [
                {
                    "chapterId": str(chapter.get("chapterId") or chapter.get("url") or chapter.get("index")),
                    "chapterTitle": str(chapter.get("chapterTitle") or chapter.get("title") or "未命名章节"),
                    "chapterIndex": int(chapter.get("chapterIndex", chapter.get("index", index))),
                    "status": "pending",
                    "completedSegments": 0,
                    "totalSegments": 0,
                    "error": None,
                }
                for index, chapter in enumerate(chapters_info)
            ],
            "createdAt": now,
            "updatedAt": now,
        }
        with self._lock:
            self._tasks[task_id] = task
            self._save_task(task)
            self._spawn_locked(task_id)
        return self.get(task_id) or task

    def _spawn_locked(self, task_id: str) -> None:
        existing = self._workers.get(task_id)
        if existing and existing.is_alive():
            return
        worker = threading.Thread(
            target=self._run_task,
            args=(task_id,),
            name=f"doubao-prefetch-{task_id[-8:]}",
            daemon=True,
        )
        self._workers[task_id] = worker
        worker.start()

    def _check_control(self, task_id: str) -> dict:
        with self._lock:
            task = self._tasks.get(task_id)
            if task is None or task.get("status") in {"cancelled", "cancelling"}:
                raise PrefetchCancelled("任务已取消")
            if task.get("status") == "paused":
                raise PrefetchPaused("任务已暂停")
            return task

    def _run_task(self, task_id: str) -> None:
        with self._lock:
            task = self._tasks.get(task_id)
            if not task:
                return
            task["status"] = "processing"
            self._save_task(task)
        try:
            chapters_info = task.get("chaptersInfo") or ([task["chapterInfo"]] if task.get("chapterInfo") else [])
            for position, chapter_info in enumerate(chapters_info):
                task = self._check_control(task_id)
                chapter_state = task["chapters"][position]
                if chapter_state.get("status") == "completed":
                    continue
                chapter_state.update({"status": "processing", "error": None})
                self._save_task(task)
                try:
                    index = self._process_chapter(task_id, task["bookInfo"], chapter_info, task["options"], chapter_state)
                    chapter_state.update(
                        {
                            "status": "completed",
                            "completedSegments": index["metadata"]["completedSegments"],
                            "totalSegments": index["metadata"]["totalSegments"],
                            "error": None,
                        }
                    )
                    if chapter_state["chapterId"] not in task["progress"]["completed"]:
                        task["progress"]["completed"].append(chapter_state["chapterId"])
                except (PrefetchPaused, PrefetchCancelled):
                    chapter_state["status"] = "pending"
                    raise
                except Exception as exc:
                    chapter_state.update({"status": "failed", "error": str(exc)})
                    task["progress"]["failed"] = [
                        item for item in task["progress"]["failed"] if item.get("chapterId") != chapter_state["chapterId"]
                    ]
                    task["progress"]["failed"].append({"chapterId": chapter_state["chapterId"], "error": str(exc)})
                finally:
                    self._save_task(task)

            self._check_control(task_id)
            with self._lock:
                failed_count = sum(chapter.get("status") == "failed" for chapter in task["chapters"])
                completed_count = sum(chapter.get("status") == "completed" for chapter in task["chapters"])
                task["progress"]["current"] = completed_count
                task["progress"]["total"] = len(task["chapters"])
                task["status"] = "completed" if failed_count == 0 else "partial" if completed_count else "failed"
                self._save_task(task)
        except PrefetchPaused:
            with self._lock:
                current = self._tasks.get(task_id)
                if current:
                    current["status"] = "paused"
                    self._save_task(current)
        except PrefetchCancelled:
            with self._lock:
                current = self._tasks.get(task_id)
                if current:
                    current["status"] = "cancelled"
                    self._save_task(current)
        finally:
            with self._lock:
                self._workers.pop(task_id, None)

    def _cached_content(self, book_info: dict, chapter_index: int) -> str:
        for identifier in (book_info.get("bookId"), book_info.get("bookUrl")):
            if not identifier:
                continue
            payload = self.book_cache.get_chapter(str(identifier), chapter_index)
            if payload and str(payload.get("content") or "").strip():
                return str(payload["content"])
        return ""

    def _chapter_content(self, book_info: dict, chapter_info: dict, options: dict) -> str:
        inline_content = str(chapter_info.get("content") or "")
        if inline_content.strip():
            return inline_content
        chapter_index = int(chapter_info.get("chapterIndex", chapter_info.get("index", 0)))
        cached = self._cached_content(book_info, chapter_index)
        if options.get("useCacheOnly"):
            if cached:
                return cached
            raise RuntimeError("强制使用缓存模式，但本地缓存不存在")
        server_ip = options.get("serverIp")
        server_port = options.get("serverPort")
        if server_ip and server_port:
            try:
                payload = self.legado_client.get_chapter_content(
                    str(server_ip), int(server_port), str(book_info.get("bookUrl") or ""), chapter_index
                )
                content = unwrap_content(payload)
                if content.strip():
                    return content
            except Exception:
                if cached:
                    return cached
                raise
        if cached:
            return cached
        raise RuntimeError("无 Web 链接且无本地缓存")

    def _process_chapter(
        self,
        task_id: str,
        book_info: dict,
        chapter_info: dict,
        options: dict,
        chapter_state: dict,
    ) -> dict:
        book_id = str(book_info.get("bookId") or book_info.get("bookUrl") or "")
        chapter_id = str(
            chapter_info.get("chapterId")
            or chapter_info.get("chapterUrl")
            or chapter_info.get("url")
            or chapter_info.get("chapterIndex", chapter_info.get("index", 0))
        )
        existing = self.audio_cache.load_chapter_index(book_id, chapter_id)
        if existing and existing.get("metadata", {}).get("status") == "completed" and not options.get("forceRegenerate"):
            return existing
        chapter_title = str(chapter_info.get("chapterTitle") or chapter_info.get("title") or "未命名章节")
        chapter_index = int(chapter_info.get("chapterIndex", chapter_info.get("index", 0)))
        content = self._chapter_content(book_info, chapter_info, options)
        if not content.strip():
            raise RuntimeError("章节内容为空")
        full_content = f"{chapter_title}\n\n{content}"
        texts = split_text_by_newline(full_content)
        if not texts:
            raise RuntimeError("章节内容分段后为空")

        previous_by_id = {
            segment.get("segmentId"): segment for segment in (existing or {}).get("segments", []) if isinstance(segment, dict)
        }
        segments = []
        for position, text in enumerate(texts, start=1):
            segment_id = f"seg_{position:03d}"
            previous = previous_by_id.get(segment_id, {})
            segments.append(
                {
                    "segmentId": segment_id,
                    "text": text,
                    "audioFile": previous.get("audioFile"),
                    "fileSize": int(previous.get("fileSize") or 0),
                    "generatedAt": previous.get("generatedAt"),
                    "error": None,
                }
            )
        created_at = (existing or {}).get("metadata", {}).get("createdAt") or utc_now_iso()

        def build_index(status: str) -> dict:
            completed = sum(bool(segment.get("audioFile")) for segment in segments)
            return {
                "bookId": book_id,
                "bookUrl": book_info.get("bookUrl") or "",
                "bookName": book_info.get("bookName") or book_info.get("name") or book_id,
                "chapterId": chapter_id,
                "chapterUrl": chapter_info.get("chapterUrl") or chapter_info.get("url") or "",
                "chapterIndex": chapter_index,
                "chapterTitle": chapter_title,
                "voiceId": options.get("voiceId"),
                "content": full_content,
                "segments": segments,
                "metadata": {
                    "totalSegments": len(segments),
                    "completedSegments": completed,
                    "totalDuration": 0,
                    "createdAt": created_at,
                    "updatedAt": utc_now_iso(),
                    "status": status,
                },
            }

        self.audio_cache.save_chapter_index(book_id, chapter_id, build_index("paused"))
        audio_dir = self.audio_cache.chapter_dir(book_id, chapter_id) / "audio"
        audio_dir.mkdir(parents=True, exist_ok=True)
        adapter = self.adapter_factory()
        speech_rate = max(-50, min(100, int(options.get("speed") or 0)))
        pitch = max(-12, min(12, int(options.get("pitch") or 0)))
        failures = []
        for position, segment in enumerate(segments):
            self._check_control(task_id)
            output_path = audio_dir / f"{segment['segmentId']}.mp3"
            if output_path.is_file() and output_path.stat().st_size > 0 and not options.get("forceRegenerate"):
                segment.update(
                    {
                        "audioFile": f"audio/{output_path.name}",
                        "fileSize": output_path.stat().st_size,
                        "generatedAt": segment.get("generatedAt") or utc_now_iso(),
                        "error": None,
                    }
                )
            else:
                last_error: Exception | None = None
                for attempt in range(3):
                    try:
                        adapter.synthesize_to_path(
                            text=segment["text"],
                            voice_id=str(options["voiceId"]),
                            output_path=output_path,
                            output_format="mp3",
                            speech_rate=speech_rate,
                            pitch=pitch,
                            request_delay_seconds=options.get("requestDelay"),
                            request_interval_seconds=options.get(
                                "requestIntervalDelay",
                                self.request_interval_seconds,
                            ),
                        )
                        segment.update(
                            {
                                "audioFile": f"audio/{output_path.name}",
                                "fileSize": output_path.stat().st_size,
                                "generatedAt": utc_now_iso(),
                                "error": None,
                            }
                        )
                        break
                    except Exception as exc:
                        last_error = exc
                        if attempt < 2:
                            self._interruptible_wait(task_id, min(2 * (attempt + 1), 5))
                if not segment.get("audioFile"):
                    segment["error"] = str(last_error or "音频生成失败")
                    failures.append(segment["segmentId"])

            task = self._check_control(task_id)
            completed = sum(bool(item.get("audioFile")) for item in segments)
            task["progress"].update({"current": completed, "total": len(segments)})
            chapter_state.update({"completedSegments": completed, "totalSegments": len(segments)})
            self.audio_cache.save_chapter_index(book_id, chapter_id, build_index("paused"))
            self._save_task(task)
        status = "completed" if not failures else "paused"
        result = build_index(status)
        self.audio_cache.save_chapter_index(book_id, chapter_id, result)
        if failures:
            raise RuntimeError(f"{len(failures)} 个段落生成失败，可稍后重试")
        return result

    def _interruptible_wait(self, task_id: str, seconds: float) -> None:
        deadline = time.monotonic() + seconds
        while time.monotonic() < deadline:
            self._check_control(task_id)
            time.sleep(min(0.1, max(0.0, deadline - time.monotonic())))

    def get(self, task_id: str) -> dict | None:
        import copy

        with self._lock:
            task = self._tasks.get(task_id)
            return copy.deepcopy(task) if task else None

    def list(self) -> list[dict]:
        with self._lock:
            task_ids = list(self._tasks)
        tasks = [self.get(task_id) for task_id in task_ids]
        return sorted((task for task in tasks if task), key=lambda task: task.get("createdAt", ""), reverse=True)

    def pause(self, task_id: str) -> None:
        with self._lock:
            task = self._tasks.get(task_id)
            if not task:
                raise KeyError(task_id)
            if task.get("status") in {"completed", "failed", "partial", "cancelled"}:
                return
            task["status"] = "paused"
            self._save_task(task)

    def resume(self, task_id: str) -> None:
        with self._lock:
            task = self._tasks.get(task_id)
            if not task:
                raise KeyError(task_id)
            if task.get("status") == "completed":
                return
            task["status"] = "processing"
            for chapter in task.get("chapters", []):
                if chapter.get("status") in {"failed", "processing"}:
                    chapter["status"] = "pending"
                    chapter["error"] = None
            self._save_task(task)
            self._spawn_locked(task_id)

    def cancel(self, task_id: str) -> dict:
        with self._lock:
            task = self._tasks.get(task_id)
            if not task:
                raise KeyError(task_id)
            if task.get("status") in {"completed", "failed", "partial", "cancelled"}:
                return {"alreadyFinished": True, "status": task["status"]}
            task["status"] = "cancelled"
            self._save_task(task)
            return {"alreadyFinished": False, "status": "cancelled"}

    def retry(self, task_id: str, chapter_id: str | None = None) -> bool:
        with self._lock:
            task = self._tasks.get(task_id)
            if not task:
                raise KeyError(task_id)
            selected = False
            for chapter in task.get("chapters", []):
                if chapter_id and chapter.get("chapterId") != chapter_id:
                    continue
                if chapter.get("status") != "completed":
                    chapter.update({"status": "pending", "error": None})
                    selected = True
            if not selected:
                return False
            task["status"] = "processing"
            task["progress"]["failed"] = []
            self._save_task(task)
            self._spawn_locked(task_id)
            return True

    def delete_task(self, task_id: str) -> bool:
        with self._lock:
            task = self._tasks.pop(task_id, None)
            if not task:
                return False
            self._task_file(task_id).unlink(missing_ok=True)
            return True

    def delete_tasks_by_book(self, book_id: str) -> int:
        with self._lock:
            task_ids = [
                task_id
                for task_id, task in self._tasks.items()
                if str(task.get("bookInfo", {}).get("bookId")) == str(book_id)
                or str(task.get("bookInfo", {}).get("bookUrl")) == str(book_id)
            ]
        return sum(self.delete_task(task_id) for task_id in task_ids)

    def delete_task_files(self, task_id: str) -> bool:
        task = self.get(task_id)
        if not task:
            return False
        book_id = str(task.get("bookInfo", {}).get("bookId") or task.get("bookInfo", {}).get("bookUrl") or "")
        for chapter in task.get("chaptersInfo", []):
            chapter_id = str(
                chapter.get("chapterId") or chapter.get("chapterUrl") or chapter.get("url") or chapter.get("chapterIndex", 0)
            )
            self.audio_cache.delete_chapter(book_id, chapter_id)
        self.delete_task(task_id)
        return True

    def clear(self) -> int:
        with self._lock:
            task_ids = list(self._tasks)
        for task_id in task_ids:
            self.cancel(task_id)
            self.delete_task(task_id)
        return len(task_ids)
