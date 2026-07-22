from pathlib import Path

from fastapi.testclient import TestClient

from tts_api.config import get_settings
from tts_api.main import create_app


def make_model_package_client(tmp_path: Path, monkeypatch):
    settings_file = tmp_path / "settings.json"
    packages_file = tmp_path / "model-packages.json"
    monkeypatch.setenv("OPEN_TTS_SETTINGS_FILE", str(settings_file))
    monkeypatch.setenv("OPEN_TTS_MODEL_PACKAGES_FILE", str(packages_file))
    monkeypatch.setenv("OPEN_TTS_INDEXTTS2_ROOT", str(tmp_path / "IndexTTS2"))
    monkeypatch.setenv("OPEN_TTS_VOXCPM2_ROOT", str(tmp_path / "VoxCPM2"))
    monkeypatch.setenv("OPEN_TTS_GPTSOVITS_ROOT", str(tmp_path / "GPT-SoVITS"))
    get_settings.cache_clear()
    return TestClient(create_app()), packages_file


def make_ready_gptsovits_package(root: Path) -> None:
    (root / "runtime").mkdir(parents=True)
    (root / "runtime" / "python.exe").write_text("python", encoding="utf-8")
    (root / "GPT_SoVITS" / "configs").mkdir(parents=True)
    (root / "GPT_SoVITS" / "configs" / "tts_infer.yaml").write_text("config", encoding="utf-8")
    (root / "api_v2.py").write_text("api", encoding="utf-8")


def test_model_packages_seed_current_model_profiles(tmp_path: Path, monkeypatch):
    client, packages_file = make_model_package_client(tmp_path, monkeypatch)

    response = client.get("/v1/model-packages")

    assert response.status_code == 200
    packages = response.json()["packages"]
    assert {package["model_id"] for package in packages} == {"indextts2", "voxcpm2", "gptsovits"}
    assert all(package["state"] == "stable" for package in packages)
    assert packages_file.exists()


def test_registers_directory_with_bounded_read_only_inspection(tmp_path: Path, monkeypatch):
    client, _ = make_model_package_client(tmp_path, monkeypatch)
    root = tmp_path / "GPT-SoVITS-v2pro"
    make_ready_gptsovits_package(root)

    response = client.post(
        "/v1/model-packages",
        json={
            "model_id": "gptsovits",
            "path": str(root),
            "package_label": "v2pro stable",
            "user_note": "手动导入的稳定包。",
        },
    )

    assert response.status_code == 201
    body = response.json()
    assert body["source_kind"] == "directory"
    assert body["state"] == "candidate"
    assert body["inspection"]["ready_for_activation"] is True
    assert body["inspection"]["adapter_status"] == "ready"
    assert body["inspection"]["file_count"] == 3
    assert body["inspection"]["checks"][-1]["id"] == "config"


def test_registers_archive_without_extracting_it(tmp_path: Path, monkeypatch):
    client, _ = make_model_package_client(tmp_path, monkeypatch)
    archive = tmp_path / "IndexTTS2-stable.7z"
    archive.write_bytes(b"archive-placeholder")

    response = client.post(
        "/v1/model-packages",
        json={"model_id": "indextts2", "path": str(archive), "package_label": "待解压 IndexTTS2"},
    )

    assert response.status_code == 201
    body = response.json()
    assert body["source_kind"] == "archive"
    assert body["inspection"]["ready_for_activation"] is False
    assert body["inspection"]["adapter_status"] == "archive"
    assert body["inspection"]["size_bytes"] == len(b"archive-placeholder")


def test_activating_new_package_archives_previous_stable_package_and_switches_instance(tmp_path: Path, monkeypatch):
    client, _ = make_model_package_client(tmp_path, monkeypatch)
    first_root = tmp_path / "GPT-SoVITS-v1"
    second_root = tmp_path / "GPT-SoVITS-v2"
    make_ready_gptsovits_package(first_root)
    make_ready_gptsovits_package(second_root)
    first = client.post("/v1/model-packages", json={"model_id": "gptsovits", "path": str(first_root), "package_label": "v1"})
    second = client.post("/v1/model-packages", json={"model_id": "gptsovits", "path": str(second_root), "package_label": "v2"})
    assert first.status_code == 201
    assert second.status_code == 201

    first_activation = client.post(f"/v1/model-packages/{first.json()['id']}/activate")
    second_activation = client.post(f"/v1/model-packages/{second.json()['id']}/activate")

    assert first_activation.status_code == 200
    assert second_activation.status_code == 200
    assert second_activation.json()["package"]["state"] == "stable"
    assert second_activation.json()["instance"]["root_path"] == str(second_root)
    packages = {package["id"]: package for package in client.get("/v1/model-packages").json()["packages"]}
    assert packages[first.json()["id"]]["state"] == "archived"
    assert packages[second.json()["id"]]["state"] == "stable"


def test_archive_cannot_be_activated(tmp_path: Path, monkeypatch):
    client, _ = make_model_package_client(tmp_path, monkeypatch)
    archive = tmp_path / "VoxCPM2-full.zip"
    archive.write_bytes(b"archive-placeholder")
    package = client.post("/v1/model-packages", json={"model_id": "voxcpm2", "path": str(archive)}).json()

    response = client.post(f"/v1/model-packages/{package['id']}/activate")

    assert response.status_code == 409
    assert "解压" in response.json()["detail"]
