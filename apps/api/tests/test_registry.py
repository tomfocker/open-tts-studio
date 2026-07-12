from pathlib import Path

from tts_api.registry import ModelRegistry


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
