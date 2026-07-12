from pathlib import Path

from fastapi.testclient import TestClient

from tts_api.config import get_settings
from tts_api.main import create_app


def make_audio_assets_client(tmp_path: Path, monkeypatch) -> TestClient:
    monkeypatch.setenv("OPEN_TTS_SETTINGS_FILE", str(tmp_path / "settings.json"))
    monkeypatch.setenv("OPEN_TTS_TASKS_FILE", str(tmp_path / "tasks.json"))
    monkeypatch.setenv("OPEN_TTS_TASK_LOG_DIR", str(tmp_path / "task-logs"))
    monkeypatch.setenv("OPEN_TTS_PROJECTS_FILE", str(tmp_path / "projects.json"))
    monkeypatch.setenv("OPEN_TTS_OUTPUT_DIR", str(tmp_path / "outputs"))
    get_settings.cache_clear()
    return TestClient(create_app())


def test_audio_assets_include_generated_metadata_and_untracked_wav_files(tmp_path: Path, monkeypatch):
    client = make_audio_assets_client(tmp_path, monkeypatch)
    generated = client.post("/v1/audio/speech", json={"model": "mock-tts", "input": "资产库测试文本"})
    assert generated.status_code == 200
    result = generated.json()

    manual_path = tmp_path / "outputs" / "manual-reference.wav"
    manual_path.write_bytes(b"not-a-real-wav-but-a-local-asset")

    response = client.get("/v1/audio-assets")

    assert response.status_code == 200
    assets = response.json()["assets"]
    generated_asset = next(asset for asset in assets if asset["file_path"] == result["file_path"])
    manual_asset = next(asset for asset in assets if asset["file_name"] == manual_path.name)
    assert generated_asset["source"] == "speech"
    assert generated_asset["model"] == "mock-tts"
    assert generated_asset["text"] == "资产库测试文本"
    assert generated_asset["audio_url"] == result["audio_url"]
    assert manual_asset["source"] == "untracked"
    assert manual_asset["file_size_bytes"] == manual_path.stat().st_size
