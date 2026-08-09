import time
from pathlib import Path

from fastapi.testclient import TestClient

from tts_api.config import get_settings
from tts_api.main import create_app
from tts_api.routes import legado as legado_routes
from tts_api.routes.legado import get_legado_services, reset_legado_services


class FakeAdapter:
    def synthesize_to_path(self, **kwargs):
        output = Path(kwargs["output_path"])
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_bytes(b"route-mp3")
        return output


def build_client(tmp_path, monkeypatch):
    monkeypatch.setenv("OPEN_TTS_SETTINGS_FILE", str(tmp_path / "settings.json"))
    monkeypatch.setenv("OPEN_TTS_DOUBAO_COOKIE_FILE", str(tmp_path / "cookies.json"))
    monkeypatch.setenv("OPEN_TTS_DOUBAO_DATA_DIR", str(tmp_path / "doubao"))
    monkeypatch.setenv("OPEN_TTS_DOUBAO_REQUEST_INTERVAL_SECONDS", "0")
    get_settings.cache_clear()
    reset_legado_services()
    return TestClient(create_app())


def test_legado_config_and_prefetch_stream_contract(tmp_path, monkeypatch):
    client = build_client(tmp_path, monkeypatch)
    config = client.get("/api/legado/tts-config", params={"voiceId": "voice-1"})
    assert config.status_code == 200
    assert "{{java.encodeURI(speakText)}}" in config.json()["url"]
    assert "{{speakSpeed}}" in config.json()["url"]
    assert client.get("/api/legado/tts-config").status_code == 400

    services = get_legado_services()
    chapter_dir = services.audio_cache.chapter_dir("book", "chapter")
    audio = chapter_dir / "audio" / "seg_001.mp3"
    audio.parent.mkdir(parents=True)
    audio.write_bytes(b"cached-mp3")
    services.audio_cache.save_chapter_index(
        "book",
        "chapter",
        {
            "bookId": "book",
            "chapterId": "chapter",
            "segments": [{"segmentId": "seg_001", "text": "缓存文本", "audioFile": "audio/seg_001.mp3"}],
            "metadata": {"status": "completed", "totalSegments": 1, "completedSegments": 1},
        },
    )

    hit = client.get("/api/reader/tts/stream-prefetch", params={"text": "缓存文本"})
    miss = client.get("/api/reader/tts/stream-prefetch", params={"text": "不存在"})

    assert hit.status_code == 200 and hit.content == b"cached-mp3"
    assert miss.status_code == 200 and miss.headers["content-type"].startswith("audio/mpeg")
    assert len(miss.content) > 100


def test_legado_realtime_delay_reaches_shared_adapter_policy(tmp_path, monkeypatch):
    client = build_client(tmp_path, monkeypatch)
    calls = []

    class ReaderAdapter:
        def __init__(self, _settings):
            pass

        def synthesize_to_path(self, **kwargs):
            calls.append(kwargs)
            output = Path(kwargs["output_path"])
            output.parent.mkdir(parents=True, exist_ok=True)
            output.write_bytes(b"reader-mp3")

    monkeypatch.setattr(legado_routes, "DoubaoWebAdapter", ReaderAdapter)
    response = client.get(
        "/api/reader/tts/stream",
        params={"text": "实时朗读", "voice": "voice-1", "delay": 7},
    )

    assert response.status_code == 200
    assert response.content == b"reader-mp3"
    assert calls[0]["request_delay_seconds"] == 7
    assert calls[0]["request_interval_seconds"] == 0


def test_legado_prefetch_task_lifecycle_and_cache_management(tmp_path, monkeypatch):
    client = build_client(tmp_path, monkeypatch)
    services = get_legado_services()
    services.prefetch.adapter_factory = lambda: FakeAdapter()
    request = {
        "bookInfo": {"bookId": "book-1", "bookName": "一本书", "bookUrl": "book://one"},
        "chapterInfo": {
            "chapterId": "chapter-1",
            "chapterTitle": "第一章",
            "chapterUrl": "/chapter/1",
            "chapterIndex": 0,
            "content": "正文第一段\n正文第二段",
        },
        "options": {"voiceId": "voice-1", "speed": 0},
    }

    started = client.post("/api/legado/prefetch/start", json=request)
    assert started.status_code == 200
    task_id = started.json()["data"]["taskId"]
    deadline = time.monotonic() + 3
    status = None
    while time.monotonic() < deadline:
        status = client.get(f"/api/legado/prefetch/status/{task_id}").json()["data"]
        if status["status"] == "completed":
            break
        time.sleep(0.02)
    assert status["status"] == "completed"
    assert status["progress"] == {"completed": 1, "total": 1, "failed": 0}

    tasks = client.get("/api/legado/prefetch/tasks").json()["data"]
    assert tasks[0]["taskId"] == task_id
    cache = client.get("/api/legado/prefetch/cache/book-1/chapter-1").json()["data"]
    assert cache["exists"] is True
    summary = client.get(f"/api/legado/prefetch/tasks/{task_id}/summary")
    assert summary.status_code == 200
    summary_data = summary.json()["data"]
    assert summary_data["bookName"] == "一本书"
    assert summary_data["chapters"][0]["segments"][0]["exists"] is True
    segment_url = summary_data["chapters"][0]["segments"][0]["audioUrl"]
    assert segment_url
    assert client.get(segment_url).content == b"route-mp3"
    audio = client.get("/api/legado/prefetch/audio", params={"text": "正文第一段"})
    assert audio.content == b"route-mp3"

    book_id = client.get("/api/legado/book-id/generate", params={"bookUrl": "book://one"}).json()["data"]["bookId"]
    assert len(book_id) == 16
    deleted = client.delete("/api/legado/prefetch/book/book-1")
    assert deleted.status_code == 200


def test_legado_book_cache_routes_use_web_service_and_persist_content(tmp_path, monkeypatch):
    client = build_client(tmp_path, monkeypatch)
    services = get_legado_services()
    monkeypatch.setattr(
        services.client,
        "get_chapter_list",
        lambda *_args: {"data": [{"index": 0, "title": "第一章", "url": "/chapter/0"}]},
    )
    monkeypatch.setattr(
        services.client,
        "get_chapter_content",
        lambda *_args: {"data": "本地缓存正文"},
    )

    response = client.post(
        "/api/legado/book-cache/start",
        json={
            "bookInfo": {"bookUrl": "book://cache", "name": "缓存书"},
            "serverIp": "127.0.0.1",
            "serverPort": 1122,
        },
    )
    assert response.status_code == 200
    assert response.json()["data"]["cachedChapters"] == 1
    progress = client.get("/api/legado/book-cache/progress", params={"bookUrl": "book://cache"})
    assert progress.status_code == 200
    assert progress.headers["content-type"].startswith("text/event-stream")
    assert '"status": "completed"' in progress.text
    assert client.post("/api/legado/book-cache/clear-progress", json={"bookUrl": "book://cache"}).status_code == 200
    assert client.get("/api/legado/book-cache/status", params={"bookUrl": "book://cache"}).json()["data"]["isCached"]
    listing = client.get("/api/legado/book-cache/list", params={"source": "cache"}).json()["data"]
    assert listing[0]["name"] == "缓存书"
    chapter = client.get(
        "/api/legado/book-cache/chapter",
        params={"bookUrl": "book://cache", "chapterIndex": 0},
    ).json()["data"]
    assert chapter["content"] == "本地缓存正文"
    assert client.get("/api/legado/book-cache/stats").json()["data"]["totalBooks"] == 1
    assert client.delete("/api/legado/book-cache/delete", params={"bookUrl": "book://cache"}).status_code == 200
