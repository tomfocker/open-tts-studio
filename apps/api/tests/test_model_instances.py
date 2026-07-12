from pathlib import Path

from fastapi.testclient import TestClient

from tts_api.config import Settings
from tts_api.config import get_settings
from tts_api.main import create_app
from tts_api.model_instances import (
    ModelInstanceProfile,
    ModelInstanceStatus,
    RuntimeType,
    apply_model_instance_to_settings,
    build_default_model_instances,
    merge_model_instance_updates,
)
from tts_api.model_health import check_model_instance


def test_default_model_instances_are_created_from_settings(tmp_path: Path):
    settings = Settings(
        indextts2_root=tmp_path / "IndexTTS2",
        voxcpm2_root=tmp_path / "VoxCPM2",
        voxcpm2_api_host="127.0.0.1",
        voxcpm2_api_port=8000,
        gptsovits_root=tmp_path / "GPT-SoVITS",
        gptsovits_api_host="127.0.0.1",
        gptsovits_api_port=9880,
    )

    instances = build_default_model_instances(settings)
    by_id = {instance.model_id: instance for instance in instances}

    assert set(by_id) == {"indextts2", "voxcpm2", "gptsovits", "f5-tts"}
    assert by_id["indextts2"].runtime_type == RuntimeType.worker_lazy_pack
    assert by_id["indextts2"].root_path == tmp_path / "IndexTTS2"
    assert by_id["voxcpm2"].runtime_type == RuntimeType.lazy_pack_api
    assert by_id["voxcpm2"].api_host == "127.0.0.1"
    assert by_id["voxcpm2"].api_port == 8000
    assert by_id["gptsovits"].runtime_type == RuntimeType.lazy_pack_api
    assert by_id["gptsovits"].api_port == 9880
    assert by_id["f5-tts"].runtime_type == RuntimeType.reserved
    assert by_id["f5-tts"].enabled is False
    assert by_id["gptsovits"].status == ModelInstanceStatus.untested


def test_model_instance_updates_override_defaults(tmp_path: Path):
    settings = Settings(indextts2_root=tmp_path / "IndexTTS2")
    updated_root = tmp_path / "stable-index"

    merged = merge_model_instance_updates(
        build_default_model_instances(settings),
        {
            "indextts2": {
                "root_path": str(updated_root),
                "enabled": False,
                "status": "disabled",
                "last_error": "manually disabled",
            }
        },
    )
    by_id = {instance.model_id: instance for instance in merged}

    assert by_id["indextts2"].root_path == updated_root
    assert by_id["indextts2"].enabled is False
    assert by_id["indextts2"].status == ModelInstanceStatus.disabled
    assert by_id["indextts2"].last_error == "manually disabled"


def test_gptsovits_health_check_passes_for_complete_lazy_pack(tmp_path: Path):
    root = tmp_path / "GPT-SoVITS"
    (root / "runtime").mkdir(parents=True)
    (root / "runtime" / "python.exe").write_text("python", encoding="utf-8")
    (root / "api_v2.py").write_text("api", encoding="utf-8")
    (root / "GPT_SoVITS" / "configs").mkdir(parents=True)
    (root / "GPT_SoVITS" / "configs" / "tts_infer.yaml").write_text("config", encoding="utf-8")
    profile = ModelInstanceProfile(
        model_id="gptsovits",
        display_name="GPT-SoVITS",
        runtime_type=RuntimeType.lazy_pack_api,
        root_path=root,
        api_host="127.0.0.1",
        api_port=9880,
    )

    result = check_model_instance(profile)

    assert result.status == ModelInstanceStatus.ready
    assert result.repair_hint is None
    assert {check.id: check.passed for check in result.checks} == {
        "root": True,
        "python": True,
        "entrypoint": True,
        "config": True,
    }


def test_gptsovits_health_check_reports_missing_python(tmp_path: Path):
    root = tmp_path / "GPT-SoVITS"
    root.mkdir()
    profile = ModelInstanceProfile(
        model_id="gptsovits",
        display_name="GPT-SoVITS",
        runtime_type=RuntimeType.lazy_pack_api,
        root_path=root,
        api_host="127.0.0.1",
        api_port=9880,
    )

    result = check_model_instance(profile)

    assert result.status == ModelInstanceStatus.broken
    assert "runtime" in result.repair_hint
    assert {check.id: check.passed for check in result.checks}["python"] is False


def test_disabled_profile_health_check_stays_disabled(tmp_path: Path):
    profile = ModelInstanceProfile(
        model_id="f5-tts",
        display_name="F5-TTS",
        enabled=False,
        runtime_type=RuntimeType.reserved,
        status=ModelInstanceStatus.disabled,
    )

    result = check_model_instance(profile)

    assert result.status == ModelInstanceStatus.disabled
    assert result.repair_hint == "模型已禁用。"


def make_model_instance_client(tmp_path: Path, monkeypatch):
    settings_file = tmp_path / "user-settings.json"
    monkeypatch.setenv("OPEN_TTS_SETTINGS_FILE", str(settings_file))
    monkeypatch.setenv("OPEN_TTS_INDEXTTS2_ROOT", str(tmp_path / "IndexTTS2"))
    monkeypatch.setenv("OPEN_TTS_VOXCPM2_ROOT", str(tmp_path / "VoxCPM2"))
    monkeypatch.setenv("OPEN_TTS_GPTSOVITS_ROOT", str(tmp_path / "GPT-SoVITS"))
    get_settings.cache_clear()
    return TestClient(create_app()), settings_file


def test_model_instances_endpoint_lists_profiles(tmp_path: Path, monkeypatch):
    client, _ = make_model_instance_client(tmp_path, monkeypatch)

    response = client.get("/v1/model-instances")

    assert response.status_code == 200
    body = response.json()
    assert {item["model_id"] for item in body["instances"]} == {"indextts2", "voxcpm2", "gptsovits", "f5-tts"}
    assert body["instances"][0]["status"] in {"untested", "disabled"}


def test_model_instance_patch_persists_profile(tmp_path: Path, monkeypatch):
    client, settings_file = make_model_instance_client(tmp_path, monkeypatch)
    stable_root = tmp_path / "stable-gptsovits"

    response = client.patch(
        "/v1/model-instances/gptsovits",
        json={
            "root_path": str(stable_root),
            "api_host": "127.0.0.1",
            "api_port": 9891,
            "enabled": True,
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["model_id"] == "gptsovits"
    assert body["root_path"] == str(stable_root)
    assert body["api_port"] == 9891
    assert settings_file.exists()
    assert get_settings().model_instances["gptsovits"]["root_path"] == str(stable_root)


def test_model_instance_patch_persists_package_notes(tmp_path: Path, monkeypatch):
    client, _ = make_model_instance_client(tmp_path, monkeypatch)

    response = client.patch(
        "/v1/model-instances/gptsovits",
        json={
            "package_label": "GPT-SoVITS v2pro 20250604",
            "user_note": "当前稳定包，先不要替换。",
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["package_label"] == "GPT-SoVITS v2pro 20250604"
    assert body["user_note"] == "当前稳定包，先不要替换。"
    assert get_settings().model_instances["gptsovits"]["package_label"] == "GPT-SoVITS v2pro 20250604"

    clear_response = client.patch(
        "/v1/model-instances/gptsovits",
        json={"package_label": None, "user_note": None},
    )

    assert clear_response.status_code == 200
    clear_body = clear_response.json()
    assert clear_body["package_label"] is None
    assert clear_body["user_note"] is None


def test_model_instance_check_updates_status(tmp_path: Path, monkeypatch):
    client, _ = make_model_instance_client(tmp_path, monkeypatch)
    root = tmp_path / "GPT-SoVITS"
    (root / "runtime").mkdir(parents=True)
    (root / "runtime" / "python.exe").write_text("python", encoding="utf-8")
    (root / "api_v2.py").write_text("api", encoding="utf-8")
    (root / "GPT_SoVITS" / "configs").mkdir(parents=True)
    (root / "GPT_SoVITS" / "configs" / "tts_infer.yaml").write_text("config", encoding="utf-8")

    response = client.post("/v1/model-instances/gptsovits/check")

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ready"
    assert body["repair_hint"] is None


def test_model_instance_check_records_recent_health_history(tmp_path: Path, monkeypatch):
    client, _ = make_model_instance_client(tmp_path, monkeypatch)
    root = tmp_path / "GPT-SoVITS"
    root.mkdir()

    response = client.post("/v1/model-instances/gptsovits/check")

    assert response.status_code == 200
    instance_response = client.get("/v1/model-instances/gptsovits")
    body = instance_response.json()
    assert body["status"] == "broken"
    assert len(body["health_history"]) == 1
    assert body["health_history"][0]["status"] == "broken"
    assert "python" in body["health_history"][0]["failed_check_ids"]


def test_apply_gptsovits_profile_to_settings(tmp_path: Path):
    settings = Settings(gptsovits_root=tmp_path / "old", gptsovits_api_port=9880)
    profile = ModelInstanceProfile(
        model_id="gptsovits",
        display_name="GPT-SoVITS",
        runtime_type=RuntimeType.lazy_pack_api,
        root_path=tmp_path / "stable",
        api_host="127.0.0.1",
        api_port=9892,
    )

    resolved = apply_model_instance_to_settings(settings, profile)

    assert resolved.gptsovits_root == tmp_path / "stable"
    assert resolved.gptsovits_api_port == 9892


def test_apply_disabled_profile_is_rejected(tmp_path: Path):
    settings = Settings()
    profile = ModelInstanceProfile(
        model_id="indextts2",
        display_name="IndexTTS2",
        enabled=False,
        runtime_type=RuntimeType.worker_lazy_pack,
        root_path=tmp_path / "IndexTTS2",
        status=ModelInstanceStatus.disabled,
    )

    try:
        apply_model_instance_to_settings(settings, profile)
    except ValueError as exc:
        assert "disabled" in str(exc)
    else:
        raise AssertionError("Expected disabled profile to be rejected.")
