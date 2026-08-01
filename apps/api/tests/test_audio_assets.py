from pathlib import Path
from types import SimpleNamespace

from fastapi.testclient import TestClient

from tts_api.config import get_settings
from tts_api.main import create_app
from tts_api.routes import audio_assets


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
    assert generated_asset["origin"] == "local"
    assert generated_asset["model"] == "mock-tts"
    assert generated_asset["text"] == "资产库测试文本"
    assert generated_asset["audio_url"] == result["audio_url"]
    assert manual_asset["source"] == "untracked"
    assert manual_asset["origin"] == "monitored"
    assert manual_asset["file_size_bytes"] == manual_path.stat().st_size


def test_audio_assets_scan_mp3_and_nested_output_files_and_delete_the_real_file(tmp_path: Path, monkeypatch):
    client = make_audio_assets_client(tmp_path, monkeypatch)
    cloud_path = tmp_path / "outputs" / "cloud" / "doubao.mp3"
    cloud_path.parent.mkdir(parents=True)
    cloud_path.write_bytes(b"not-a-real-mp3-but-a-cloud-asset")

    response = client.get("/v1/audio-assets")

    assert response.status_code == 200
    asset = next(asset for asset in response.json()["assets"] if asset["file_path"] == str(cloud_path))
    assert asset["asset_id"] == "cloud/doubao.mp3"
    assert asset["source"] == "untracked"
    assert asset["origin"] == "monitored"
    assert asset["audio_url"].startswith("/v1/audio-assets/content?")

    deleted = client.delete("/v1/audio-assets", params={"asset_id": asset["asset_id"]})
    assert deleted.status_code == 200
    assert deleted.json() == {"deleted": True, "asset_id": "cloud/doubao.mp3"}
    assert not cloud_path.exists()
    assert client.get("/v1/audio-assets").json()["assets"] == []


def test_audio_asset_delete_rejects_paths_outside_the_monitored_output_directory(tmp_path: Path, monkeypatch):
    client = make_audio_assets_client(tmp_path, monkeypatch)
    outside = tmp_path / "outside.wav"
    outside.write_bytes(b"keep-me")

    response = client.delete("/v1/audio-assets", params={"asset_id": "../outside.wav"})

    assert response.status_code == 404
    assert outside.exists()


def test_audio_assets_classify_doubao_results_as_cloud_output(tmp_path: Path, monkeypatch):
    client = make_audio_assets_client(tmp_path, monkeypatch)
    output = tmp_path / "outputs" / "doubao-result.mp3"
    output.write_bytes(b"cloud-audio")
    cloud_job = SimpleNamespace(
        id="cloud-job",
        request=SimpleNamespace(input="云端生成文本"),
        result=SimpleNamespace(
            file_path=str(output),
            model="doubao-web",
            duration_seconds=1.25,
        ),
    )
    monkeypatch.setattr(audio_assets, "get_job_store", lambda: SimpleNamespace(list=lambda limit: [cloud_job]))
    monkeypatch.setattr(audio_assets, "get_project_store", lambda: SimpleNamespace(list=lambda: []))

    response = client.get("/v1/audio-assets")

    assert response.status_code == 200
    asset = response.json()["assets"][0]
    assert asset["source"] == "speech"
    assert asset["origin"] == "cloud"
    assert asset["model"] == "doubao-web"
    assert asset["text"] == "云端生成文本"
