from pathlib import Path

from tts_api.registry import ModelRegistry
from tts_api.config import get_settings
from tts_api.main import create_app
from fastapi.testclient import TestClient


def test_registry_loads_models_from_json(tmp_path: Path):
    registry_path = tmp_path / "models.json"
    registry_path.write_text(
        """
        [
          {
            "id": "mock-tts",
            "display_name": "Mock TTS",
            "priority": "P0",
            "source_url": "local",
            "code_license": "MIT",
            "weights_license": "MIT",
            "commercial_use": "allowed",
            "recommended_vram_gb": 0,
            "features": ["plain_tts", "streaming"],
            "native_sample_rate": 24000,
            "adapter": "mock"
          }
        ]
        """,
        encoding="utf-8",
    )

    registry = ModelRegistry(registry_path)
    models = registry.list_models()

    assert len(models) == 1
    assert models[0].id == "mock-tts"
    assert models[0].features == ["plain_tts", "streaming"]


def test_registry_returns_model_by_id(tmp_path: Path):
    registry_path = tmp_path / "models.json"
    registry_path.write_text(
        """
        [
          {
            "id": "mock-tts",
            "display_name": "Mock TTS",
            "priority": "P0",
            "source_url": "local",
            "code_license": "MIT",
            "weights_license": "MIT",
            "commercial_use": "allowed",
            "recommended_vram_gb": 0,
            "features": ["plain_tts"],
            "native_sample_rate": 24000,
            "adapter": "mock"
          }
        ]
        """,
        encoding="utf-8",
    )

    registry = ModelRegistry(registry_path)
    model = registry.get_model("mock-tts")

    assert model.id == "mock-tts"
    assert model.adapter == "mock"
    assert model.request_capabilities == []
    assert model.requires_reference_audio is False


def test_capabilities_endpoint_exposes_stable_adapter_boundaries(tmp_path: Path, monkeypatch):
    monkeypatch.setenv("OPEN_TTS_SETTINGS_FILE", str(tmp_path / "settings.json"))
    get_settings.cache_clear()
    client = TestClient(create_app())

    response = client.get("/v1/tts/capabilities")

    assert response.status_code == 200
    body = response.json()
    gptsovits = next(item for item in body["models"] if item["model"]["id"] == "gptsovits")
    assert body["response_formats"] == ["wav"]
    assert body["streaming"] is False
    assert gptsovits["requires_reference_audio"] is True
    assert "reference_audio" in gptsovits["accepted_parameters"]
