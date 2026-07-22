import json
from pathlib import Path

from tts_api.schemas import ModelInfo


class ModelRegistry:
    def __init__(self, registry_path: Path):
        self.registry_path = registry_path

    def list_models(self, include_internal: bool = True) -> list[ModelInfo]:
        raw = json.loads(self.registry_path.read_text(encoding="utf-8"))
        models = [ModelInfo.model_validate(item) for item in raw]
        return models if include_internal else [model for model in models if not model.internal_only]

    def get_model(self, model_id: str) -> ModelInfo:
        for model in self.list_models(include_internal=True):
            if model.id == model_id:
                return model
        raise KeyError(f"Unknown model: {model_id}")
