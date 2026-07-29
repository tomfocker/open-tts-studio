import time
from pathlib import Path

from tts_api.doubao_cache import BookCacheService, PrefetchAudioCache
from tts_api.doubao_prefetch import DoubaoPrefetchManager


class FakeLegadoClient:
    def get_chapter_content(self, *_args):
        return {"data": "网络正文"}


class FakeAdapter:
    def __init__(self):
        self.calls = []

    def synthesize_to_path(self, **kwargs):
        self.calls.append(kwargs)
        output = Path(kwargs["output_path"])
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_bytes(b"fake-mp3")
        return output


def wait_for_status(manager, task_id, expected, timeout=3):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        task = manager.get(task_id)
        if task and task["status"] in expected:
            return task
        time.sleep(0.02)
    raise AssertionError(f"task did not reach {expected}: {manager.get(task_id)}")


def build_manager(tmp_path, adapter):
    client = FakeLegadoClient()
    audio_cache = PrefetchAudioCache(tmp_path)
    book_cache = BookCacheService(tmp_path, client, concurrency=1)
    return DoubaoPrefetchManager(
        audio_cache,
        book_cache,
        client,
        lambda: adapter,
        request_interval_seconds=0,
    )


def test_prefetch_task_persists_segments_and_can_be_loaded_after_restart(tmp_path):
    adapter = FakeAdapter()
    manager = build_manager(tmp_path, adapter)
    task = manager.start(
        {"bookId": "book-1", "bookName": "测试书", "bookUrl": "book://one"},
        {
            "chapterId": "chapter-1",
            "chapterTitle": "第一章",
            "chapterUrl": "/chapter/1",
            "chapterIndex": 0,
            "content": "第一段\n\n第二段",
        },
        {"voiceId": "voice-1", "speed": 12},
    )

    completed = wait_for_status(manager, task["taskId"], {"completed"})
    index = manager.audio_cache.load_chapter_index("book-1", "chapter-1")

    assert completed["chapters"][0]["completedSegments"] == 3
    assert index["metadata"]["status"] == "completed"
    assert [segment["text"] for segment in index["segments"]] == ["第一章", "第一段", "第二段"]
    assert all(Path(manager.audio_cache.chapter_dir("book-1", "chapter-1") / segment["audioFile"]).exists() for segment in index["segments"])
    assert all(call["speech_rate"] == 12 for call in adapter.calls)

    restored = build_manager(tmp_path, FakeAdapter())
    assert restored.get(task["taskId"])["status"] == "completed"


def test_prefetch_failed_task_can_retry_without_regenerating_existing_files(tmp_path):
    class FailOnceAdapter(FakeAdapter):
        def __init__(self):
            super().__init__()
            self.fail = True

        def synthesize_to_path(self, **kwargs):
            if self.fail:
                self.fail = False
                raise RuntimeError("temporary")
            return super().synthesize_to_path(**kwargs)

    adapter = FailOnceAdapter()
    manager = build_manager(tmp_path, adapter)
    task = manager.start(
        {"bookId": "book-2", "bookName": "测试书", "bookUrl": "book://two"},
        {
            "chapterId": "chapter-2",
            "chapterTitle": "第二章",
            "chapterUrl": "/chapter/2",
            "chapterIndex": 1,
            "content": "正文",
        },
        {"voiceId": "voice-1"},
    )

    # Each segment has three internal attempts, so one transient failure is
    # recovered inside the same persisted task.
    completed = wait_for_status(manager, task["taskId"], {"completed"})
    assert completed["status"] == "completed"
    assert len(adapter.calls) == 2


def test_prefetch_delegates_delays_to_adapter_without_manager_level_sleep(tmp_path):
    adapter = FakeAdapter()
    manager = build_manager(tmp_path, adapter)
    manager.request_interval_seconds = 2.5

    def unexpected_wait(*_args):
        raise AssertionError("prefetch manager must not duplicate the shared adapter delay")

    manager._interruptible_wait = unexpected_wait
    task = manager.start(
        {"bookId": "book-3", "bookName": "测试书", "bookUrl": "book://three"},
        {
            "chapterId": "chapter-3",
            "chapterTitle": "第三章",
            "chapterIndex": 2,
            "content": "正文",
        },
        {"voiceId": "voice-1", "requestDelay": 7},
    )

    completed = wait_for_status(manager, task["taskId"], {"completed", "failed"})
    assert completed["status"] == "completed"
    assert adapter.calls
    assert all(call["request_delay_seconds"] == 7 for call in adapter.calls)
    assert all(call["request_interval_seconds"] == 2.5 for call in adapter.calls)
