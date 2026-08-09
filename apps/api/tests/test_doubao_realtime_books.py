from io import BytesIO
from zipfile import ZIP_DEFLATED, ZipFile

from fastapi.testclient import TestClient

from tts_api.config import get_settings
from tts_api.main import create_app
from tts_api.schemas import SpeechResult


def build_client(tmp_path, monkeypatch):
    monkeypatch.setenv("OPEN_TTS_SETTINGS_FILE", str(tmp_path / "settings.json"))
    monkeypatch.setenv("OPEN_TTS_DOUBAO_COOKIE_FILE", str(tmp_path / "doubao-cookies.json"))
    get_settings.cache_clear()
    return TestClient(create_app())


def test_txt_ebook_import_returns_prefetch_compatible_inline_chapters(tmp_path, monkeypatch):
    client = build_client(tmp_path, monkeypatch)
    content = "序章\n这是开头。\n\n第一章 初遇\n他们在车站见面。\n\n第二章 远行\n故事继续。"
    response = client.post(
        "/v1/doubao/books/import",
        files={"file": ("我的故事.txt", BytesIO(content.encode("utf-8")), "text/plain")},
    )

    assert response.status_code == 200
    payload = response.json()["data"]
    assert payload["bookInfo"]["bookName"] == "我的故事"
    assert len(payload["chaptersInfo"]) == 3
    assert payload["chaptersInfo"][1]["chapterTitle"] == "第一章 初遇"
    assert "他们在车站" in payload["chaptersInfo"][1]["content"]
    assert payload["chaptersInfo"][1]["chapterUrl"].startswith("local://")


def test_epub_import_follows_spine_and_extracts_chapter_text(tmp_path, monkeypatch):
    client = build_client(tmp_path, monkeypatch)
    archive = BytesIO()
    with ZipFile(archive, "w", ZIP_DEFLATED) as epub:
        epub.writestr(
            "META-INF/container.xml",
            '<container><rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>',
        )
        epub.writestr(
            "OEBPS/content.opf",
            '<package><manifest><item id="c1" href="chapter-1.xhtml"/><item id="c2" href="chapter-2.xhtml"/></manifest><spine><itemref idref="c1"/><itemref idref="c2"/></spine></package>',
        )
        epub.writestr("OEBPS/chapter-1.xhtml", "<html><body><h1>第一章</h1><p>第一段正文。</p></body></html>")
        epub.writestr("OEBPS/chapter-2.xhtml", "<html><body><h1>第二章</h1><p>第二段正文。</p></body></html>")
    archive.seek(0)

    response = client.post(
        "/v1/doubao/books/import",
        files={"file": ("小说.epub", archive, "application/epub+zip")},
    )

    assert response.status_code == 200
    chapters = response.json()["data"]["chaptersInfo"]
    assert [chapter["chapterTitle"] for chapter in chapters] == ["第一章", "第二章"]
    assert chapters[0]["content"] == "第一段正文。"


def test_doubao_realtime_turn_reuses_global_llm_and_web_adapter(tmp_path, monkeypatch):
    client = build_client(tmp_path, monkeypatch)
    captured = {}

    def fake_chat_completion(**kwargs):
        captured.update(kwargs)
        return {"content": "你好，主人。", "model": "gpt-5.6-luna", "usage": None}

    monkeypatch.setattr("tts_api.routes.doubao_realtime.chat_completion", fake_chat_completion)
    monkeypatch.setattr(
        "tts_api.routes.doubao_realtime.DoubaoWebAdapter.synthesize",
        lambda _self, _request: SpeechResult(
            audio_url="/outputs/realtime.mp3",
            file_path=str(tmp_path / "realtime.mp3"),
            model="doubao-web",
            sample_rate=24_000,
            duration_seconds=1.2,
        ),
    )

    response = client.post(
        "/v1/doubao/realtime/turn",
        json={
            "base_url": "https://example.test/v1",
            "model": "gpt-5.6-luna",
            "api_key": "secret",
            "messages": [
                {"role": "user", "text": "请和我打个招呼"},
            ],
            "voice_id": "zh_female_wenroutaozi_uranus_bigtts",
        },
    )

    assert response.status_code == 200
    assert response.json()["assistantText"] == "你好，主人。"
    assert response.json()["audio"]["audio_url"] == "/outputs/realtime.mp3"
    assert captured["messages"][0]["role"] == "system"
    assert captured["messages"][-1] == {"role": "user", "content": "请和我打个招呼"}
