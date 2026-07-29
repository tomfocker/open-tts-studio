from pathlib import Path

from tts_api.doubao_cache import (
    BookCacheService,
    PrefetchAudioCache,
    safe_cache_id,
    split_text_by_newline,
)


class FakeLegadoClient:
    def __init__(self):
        self.content_calls = []

    def get_chapter_list(self, _server_ip, _server_port, _book_url):
        return {
            "data": [
                {"index": 0, "title": "第一章", "url": "/chapter/0"},
                {"index": 1, "title": "第二章", "url": "/chapter/1"},
            ]
        }

    def get_chapter_content(self, _server_ip, _server_port, _book_url, chapter_index):
        self.content_calls.append(chapter_index)
        return {"data": f"第 {chapter_index + 1} 章正文"}

    def get_cover(self, *_args):
        return b"jpeg", "image/jpeg"


def test_safe_cache_id_and_newline_split_match_upstream_contract():
    assert safe_cache_id("https://example.test/book/1") == "f341d1a6b7c5727b"
    assert safe_cache_id("ABCDEF0123456789") == "abcdef0123456789"
    assert split_text_by_newline(" 标题\r\n\r正文一\n  正文二  ") == ["标题", "正文一", "正文二"]


def test_prefetch_audio_cache_saves_queries_and_deletes_indexed_audio(tmp_path):
    cache = PrefetchAudioCache(tmp_path)
    chapter_dir = cache.chapter_dir("book-url", "chapter-url")
    audio_path = chapter_dir / "audio" / "seg_001.mp3"
    audio_path.parent.mkdir(parents=True)
    audio_path.write_bytes(b"mp3-data")
    cache.save_chapter_index(
        "book-url",
        "chapter-url",
        {
            "bookId": "book-url",
            "bookName": "测试书",
            "chapterId": "chapter-url",
            "chapterIndex": 0,
            "chapterTitle": "第一章",
            "segments": [
                {
                    "segmentId": "seg_001",
                    "text": "你好，世界！",
                    "audioFile": "audio/seg_001.mp3",
                    "fileSize": 8,
                }
            ],
            "metadata": {"status": "completed", "totalSegments": 1, "completedSegments": 1},
        },
    )

    exact = cache.find_audio_by_text("你好世界")
    fuzzy = cache.find_audio_by_text("你好，世界。")

    assert exact and Path(exact["audioPath"]) == audio_path.resolve()
    assert fuzzy and fuzzy["score"] == 1.0
    assert cache.metrics()["cacheHits"] == 2
    assert cache.list_books()[0]["name"] == "测试书"
    assert cache.delete_chapter("book-url", "chapter-url") is True
    assert cache.find_audio_by_text("你好世界") is None


def test_book_cache_downloads_skips_existing_and_reports_stats(tmp_path):
    legado = FakeLegadoClient()
    cache = BookCacheService(tmp_path, legado, concurrency=2)
    progress = []
    book = {"bookUrl": "book://one", "name": "一本书", "author": "作者"}

    first = cache.cache_book(book, "127.0.0.1", 1122, progress.append)
    second = cache.cache_book(book, "127.0.0.1", 1122, progress.append)

    assert first["cachedChapters"] == 2
    assert first["newCachedChapters"] == 2
    assert second["newCachedChapters"] == 0
    assert second["skippedChapters"] == 2
    assert cache.get_chapter("book://one", 1)["content"] == "第 2 章正文"
    assert cache.list_chapters("book://one")[0]["title"] == "第一章"
    assert cache.stats()["totalBooks"] == 1
    assert cache.stats()["totalChapters"] == 2
    assert progress[-1]["status"] == "completed"
    assert cache.delete_book("book://one") is True
    assert cache.list_books() == []
