from pathlib import Path

from fastapi.testclient import TestClient

from tts_api.config import get_settings
from tts_api.main import create_app


def make_settings_client(tmp_path: Path, monkeypatch):
    settings_file = tmp_path / "user-settings.json"
    monkeypatch.setenv("OPEN_TTS_SETTINGS_FILE", str(settings_file))
    get_settings.cache_clear()
    return TestClient(create_app()), settings_file


def test_settings_endpoint_returns_runtime_defaults(tmp_path: Path, monkeypatch):
    client, settings_file = make_settings_client(tmp_path, monkeypatch)

    response = client.get("/v1/settings")

    assert response.status_code == 200
    body = response.json()
    assert body["api_host"] == "127.0.0.1"
    assert body["api_port"] == 8765
    assert body["indextts2_idle_timeout_seconds"] == 600
    assert body["local_api_idle_timeout_seconds"] == 600
    assert body["settings_file"] == str(settings_file)
    assert "api_port" in body["restart_required_fields"]


def test_settings_endpoint_persists_updates_and_refreshes_runtime(tmp_path: Path, monkeypatch):
    client, settings_file = make_settings_client(tmp_path, monkeypatch)
    custom_output = tmp_path / "outputs"
    custom_index = tmp_path / "IndexTTS2"

    response = client.patch(
        "/v1/settings",
        json={
            "output_dir": str(custom_output),
            "indextts2_root": str(custom_index),
            "indextts2_idle_timeout_seconds": 120,
            "local_api_idle_timeout_seconds": 150,
            "api_port": 8877,
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["output_dir"] == str(custom_output)
    assert body["indextts2_root"] == str(custom_index)
    assert body["indextts2_idle_timeout_seconds"] == 120
    assert body["local_api_idle_timeout_seconds"] == 150
    assert body["api_port"] == 8877
    assert "api_port" in body["restart_required_fields"]
    assert settings_file.exists()

    settings = get_settings()
    assert settings.output_dir == custom_output
    assert settings.indextts2_root == custom_index
    assert settings.indextts2_idle_timeout_seconds == 120
    assert settings.local_api_idle_timeout_seconds == 150


def test_settings_endpoint_syncs_model_instance_profiles(tmp_path: Path, monkeypatch):
    client, _ = make_settings_client(tmp_path, monkeypatch)
    old_vox = tmp_path / "old-VoxCPM2"
    old_gptsovits = tmp_path / "old-GPT-SoVITS"
    custom_index = tmp_path / "IndexTTS2"
    custom_vox = tmp_path / "VoxCPM2"
    custom_gptsovits = tmp_path / "GPT-SoVITS"
    vox_profile_response = client.patch(
        "/v1/model-instances/voxcpm2",
        json={"root_path": str(old_vox), "api_port": 8001},
    )
    gptsovits_profile_response = client.patch(
        "/v1/model-instances/gptsovits",
        json={"root_path": str(old_gptsovits), "api_port": 9881},
    )
    assert vox_profile_response.status_code == 200
    assert gptsovits_profile_response.status_code == 200

    response = client.patch(
        "/v1/settings",
        json={
            "indextts2_root": str(custom_index),
            "voxcpm2_root": str(custom_vox),
            "voxcpm2_api_port": 8012,
            "gptsovits_root": str(custom_gptsovits),
            "gptsovits_api_port": 9890,
        },
    )
    assert response.status_code == 200

    instances_response = client.get("/v1/model-instances")

    assert instances_response.status_code == 200
    instances = {item["model_id"]: item for item in instances_response.json()["instances"]}
    assert instances["indextts2"]["root_path"] == str(custom_index)
    assert instances["voxcpm2"]["root_path"] == str(custom_vox)
    assert instances["voxcpm2"]["api_port"] == 8012
    assert instances["gptsovits"]["root_path"] == str(custom_gptsovits)
    assert instances["gptsovits"]["api_port"] == 9890


def test_generated_audio_is_served_from_updated_output_dir(tmp_path: Path, monkeypatch):
    client, _ = make_settings_client(tmp_path, monkeypatch)
    custom_output = tmp_path / "custom-outputs"

    settings_response = client.patch("/v1/settings", json={"output_dir": str(custom_output)})
    assert settings_response.status_code == 200

    speech_response = client.post(
        "/v1/audio/speech",
        json={"model": "mock-tts", "input": "hello", "response_format": "wav"},
    )

    assert speech_response.status_code == 200
    audio_url = speech_response.json()["audio_url"]
    audio_response = client.get(audio_url)
    assert audio_response.status_code == 200
    assert audio_response.content.startswith(b"RIFF")


def test_settings_endpoint_rejects_too_short_idle_timeout(tmp_path: Path, monkeypatch):
    client, _ = make_settings_client(tmp_path, monkeypatch)

    response = client.patch("/v1/settings", json={"indextts2_idle_timeout_seconds": 5})

    assert response.status_code == 422
