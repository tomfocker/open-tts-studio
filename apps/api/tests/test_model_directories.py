from pathlib import Path

from fastapi.testclient import TestClient

from tts_api.config import get_settings
from tts_api.main import create_app


def test_model_directories_returns_known_model_roots(tmp_path: Path, monkeypatch):
    settings_file = tmp_path / "settings.json"
    index_root = tmp_path / "IndexTTS2"
    vox_root = tmp_path / "VoxCPM2"
    gptsovits_root = tmp_path / "GPT-SoVITS"
    output_dir = tmp_path / "outputs"
    index_root.mkdir()
    gptsovits_root.mkdir()
    output_dir.mkdir()
    monkeypatch.setenv("OPEN_TTS_SETTINGS_FILE", str(settings_file))
    monkeypatch.setenv("OPEN_TTS_OUTPUT_DIR", str(output_dir))
    monkeypatch.setenv("OPEN_TTS_INDEXTTS2_ROOT", str(index_root))
    monkeypatch.setenv("OPEN_TTS_VOXCPM2_ROOT", str(vox_root))
    monkeypatch.setenv("OPEN_TTS_GPTSOVITS_ROOT", str(gptsovits_root))
    get_settings.cache_clear()
    client = TestClient(create_app())

    response = client.get("/v1/model-directories")

    assert response.status_code == 200
    body = response.json()
    directories = {item["id"]: item for item in body["directories"]}
    assert directories["indextts2"]["path"] == str(index_root)
    assert directories["indextts2"]["exists"] is True
    assert directories["voxcpm2"]["path"] == str(vox_root)
    assert directories["voxcpm2"]["exists"] is False
    assert directories["gptsovits"]["path"] == str(gptsovits_root)
    assert directories["gptsovits"]["exists"] is True
    assert directories["outputs"]["path"] == str(output_dir)
    assert directories["outputs"]["exists"] is True


def test_model_directories_use_active_model_instance_paths(tmp_path: Path, monkeypatch):
    settings_file = tmp_path / "settings.json"
    old_gptsovits_root = tmp_path / "old-gptsovits"
    stable_gptsovits_root = tmp_path / "stable-gptsovits"
    old_gptsovits_root.mkdir()
    stable_gptsovits_root.mkdir()
    monkeypatch.setenv("OPEN_TTS_SETTINGS_FILE", str(settings_file))
    monkeypatch.setenv("OPEN_TTS_GPTSOVITS_ROOT", str(old_gptsovits_root))
    get_settings.cache_clear()
    client = TestClient(create_app())
    update_response = client.patch(
        "/v1/model-instances/gptsovits",
        json={"root_path": str(stable_gptsovits_root)},
    )
    assert update_response.status_code == 200

    response = client.get("/v1/model-directories")

    assert response.status_code == 200
    directories = {item["id"]: item for item in response.json()["directories"]}
    assert directories["gptsovits"]["path"] == str(stable_gptsovits_root)
    assert directories["gptsovits"]["exists"] is True


def test_settings_endpoint_persists_voxcpm2_directory(tmp_path: Path, monkeypatch):
    settings_file = tmp_path / "settings.json"
    vox_root = tmp_path / "VoxCPM2"
    monkeypatch.setenv("OPEN_TTS_SETTINGS_FILE", str(settings_file))
    get_settings.cache_clear()
    client = TestClient(create_app())

    response = client.patch(
        "/v1/settings",
        json={
            "voxcpm2_root": str(vox_root),
            "voxcpm2_api_port": 8012,
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["voxcpm2_root"] == str(vox_root)
    assert body["voxcpm2_api_port"] == 8012
    assert get_settings().voxcpm2_root == vox_root


def test_settings_endpoint_persists_gptsovits_directory(tmp_path: Path, monkeypatch):
    settings_file = tmp_path / "settings.json"
    gptsovits_root = tmp_path / "GPT-SoVITS"
    monkeypatch.setenv("OPEN_TTS_SETTINGS_FILE", str(settings_file))
    get_settings.cache_clear()
    client = TestClient(create_app())

    response = client.patch(
        "/v1/settings",
        json={
            "gptsovits_root": str(gptsovits_root),
            "gptsovits_api_port": 9890,
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["gptsovits_root"] == str(gptsovits_root)
    assert body["gptsovits_api_port"] == 9890
    assert get_settings().gptsovits_root == gptsovits_root
