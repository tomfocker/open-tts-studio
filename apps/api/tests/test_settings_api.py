from pathlib import Path

from fastapi.testclient import TestClient

from tts_api.config import get_settings
from tts_api.main import create_app


def make_settings_client(tmp_path: Path, monkeypatch):
    settings_file = tmp_path / "user-settings.json"
    monkeypatch.setenv("OPEN_TTS_SETTINGS_FILE", str(settings_file))
    monkeypatch.setenv("OPEN_TTS_MODEL_PACKAGES_FILE", str(tmp_path / "model-packages.json"))
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


def test_settings_export_contains_only_safe_versioned_migration_data(tmp_path: Path, monkeypatch):
    monkeypatch.setenv("OPEN_TTS_API_KEY", "must-not-be-exported")
    client, _ = make_settings_client(tmp_path, monkeypatch)
    stable_root = tmp_path / "stable" / "IndexTTS2"
    update_response = client.patch(
        "/v1/model-instances/indextts2",
        headers={"X-OpenTTS-Key": "must-not-be-exported"},
        json={
            "root_path": str(stable_root),
            "package_label": "本机稳定包",
            "user_note": "导出时保留该维护备注。",
        },
    )
    assert update_response.status_code == 200

    response = client.get("/v1/settings/export", headers={"X-OpenTTS-Key": "must-not-be-exported"})

    assert response.status_code == 200
    body = response.json()
    assert body["schema"] == "open-tts-studio-settings"
    assert body["version"] == 1
    assert body["settings"]["indextts2_idle_timeout_seconds"] == 600
    assert {package["model_id"] for package in body["model_packages"]} == {"indextts2", "voxcpm2", "gptsovits"}
    assert body["model_instances"]["indextts2"] == {
        "enabled": True,
        "root_path": str(stable_root),
        "package_label": "本机稳定包",
        "user_note": "导出时保留该维护备注。",
    }
    serialized = str(body)
    assert "must-not-be-exported" not in serialized
    assert "settings_file" not in serialized
    assert "health_history" not in serialized
    assert "last_error" not in serialized


def test_settings_import_restores_portable_settings_and_model_profiles(tmp_path: Path, monkeypatch):
    client, settings_file = make_settings_client(tmp_path, monkeypatch)
    export_response = client.get("/v1/settings/export")
    assert export_response.status_code == 200
    backup = export_response.json()
    imported_output = tmp_path / "migrated-outputs"
    imported_root = tmp_path / "migrated" / "VoxCPM2"
    backup["settings"].update(
        {
            "api_host": "0.0.0.0",
            "api_port": 8899,
            "output_dir": str(imported_output),
            "indextts2_idle_timeout_seconds": 180,
            "local_api_idle_timeout_seconds": 240,
        }
    )
    backup["model_instances"]["voxcpm2"] = {
        "enabled": True,
        "root_path": str(imported_root),
        "api_host": "127.0.0.1",
        "api_port": 8010,
        "package_label": "已验证的稳定包",
        "user_note": "迁移后先执行检查。",
    }

    import_response = client.post("/v1/settings/import", json=backup)

    assert import_response.status_code == 200
    assert import_response.json()["output_dir"] == str(imported_output)
    assert import_response.json()["api_port"] == 8899
    assert import_response.json()["indextts2_idle_timeout_seconds"] == 180
    assert import_response.json()["local_api_idle_timeout_seconds"] == 240

    instances_response = client.get("/v1/model-instances")
    instances = {item["model_id"]: item for item in instances_response.json()["instances"]}
    assert instances["voxcpm2"]["root_path"] == str(imported_root)
    assert instances["voxcpm2"]["api_port"] == 8010
    assert instances["voxcpm2"]["package_label"] == "已验证的稳定包"
    assert instances["voxcpm2"]["user_note"] == "迁移后先执行检查。"
    assert instances["voxcpm2"]["status"] == "untested"
    assert "api_access_key" not in settings_file.read_text(encoding="utf-8")


def test_settings_import_rejects_an_unknown_model_profile(tmp_path: Path, monkeypatch):
    client, _ = make_settings_client(tmp_path, monkeypatch)
    backup = client.get("/v1/settings/export").json()
    backup["model_instances"]["future-tts"] = {"enabled": True, "root_path": "D:/models/future-tts"}

    response = client.post("/v1/settings/import", json=backup)

    assert response.status_code == 422
    assert "future-tts" in response.json()["detail"]
