from pathlib import Path

from fastapi.testclient import TestClient

from tts_api.config import get_settings
from tts_api.main import create_app
from tts_api.routes.legado import reset_legado_services


def build_client(tmp_path, monkeypatch):
    monkeypatch.setenv("OPEN_TTS_SETTINGS_FILE", str(tmp_path / "settings.json"))
    monkeypatch.setenv("OPEN_TTS_DOUBAO_DATA_DIR", str(tmp_path / "doubao"))
    monkeypatch.setenv("OPEN_TTS_DOUBAO_COOKIE_FILE", str(tmp_path / "cookies.json"))
    monkeypatch.setenv("OPEN_TTS_TASK_LOG_DIR", str(tmp_path / "logs"))
    get_settings.cache_clear()
    reset_legado_services()
    return TestClient(create_app())


def test_legacy_settings_items_device_id_and_safe_update_contract(tmp_path, monkeypatch):
    monkeypatch.setenv("OPEN_TTS_APP_VERSION", "9.8.7")
    client = build_client(tmp_path, monkeypatch)

    initial = client.get("/api/settings").json()["data"]
    assert initial["prefetch"]["cacheConcurrent"] == 20
    assert initial["tts"]["maxRetries"] == 3

    changed = client.put(
        "/api/settings/item",
        json={"path": "prefetch.cacheConcurrent", "value": 7},
    )
    assert changed.status_code == 200
    assert client.get(
        "/api/settings/item",
        params={"path": "prefetch.cacheConcurrent"},
    ).json()["data"]["value"] == 7
    assert client.get("/v1/settings").json()["book_cache_concurrency"] == 7

    first_device = client.get("/api/settings/device-id").json()["data"]
    regenerated = client.post("/api/settings/device-id/regenerate").json()["data"]
    assert len(first_device["deviceId"]) == 19
    assert regenerated["deviceId"] != first_device["deviceId"]
    assert client.post(
        "/api/settings/device-id/auto-generate",
        json={"enabled": True},
    ).json()["data"]["autoGenerate"] is True

    update = client.post("/api/settings/update")
    assert update.status_code == 410
    assert "桌面端安全更新" in update.json()["message"]
    assert client.get("/api/force-update").json()["data"]["currentVersion"] == "v9.8.7"
    assert client.get("/api/service-status").json()["status"] == "ok"


def test_legacy_console_docs_and_audio_cleanup(tmp_path, monkeypatch):
    client = build_client(tmp_path, monkeypatch)
    settings = get_settings()
    log_file = settings.task_log_dir / "test.log"
    log_file.parent.mkdir(parents=True)
    log_file.write_text("log", encoding="utf-8")

    stats = client.get("/api/console/cache-stats").json()["data"]
    assert stats == {"fileCount": 1, "totalSize": 3}
    assert client.get("/api/console/health").json()["data"]["status"] == "healthy"
    assert client.get("/api/console/clean-cache").json()["data"]["deletedCount"] == 1

    documents = client.get("/api/docs").json()["data"]
    assert documents
    document = client.get(f"/api/docs/{documents[0]['id']}").json()["data"]
    assert document["extension"] == ".md"
    assert document["content"]
    search = client.get("/api/docs/search", params={"q": "OpenTTS"})
    assert search.status_code == 200

    audio = settings.output_dir / "legacy.mp3"
    audio.parent.mkdir(parents=True, exist_ok=True)
    audio.write_bytes(b"mp3")
    assert client.get("/audio/legacy.mp3").headers["content-type"].startswith("audio/mpeg")
    assert client.delete("/api/audio/legacy.mp3").json()["data"]["deleted"] is True
    assert not audio.exists()
