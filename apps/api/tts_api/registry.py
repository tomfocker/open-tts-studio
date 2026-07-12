import json
from pathlib import Path

from tts_api.schemas import ModelInfo


class ModelRegistry:
    def __init__(self, registry_path: Path):
        self.registry_path = registry_path

    def list_models(self) -> list[ModelInfo]:
        raw = json.loads(self.registry_path.read_text(encoding="utf-8"))
        return [ModelInfo.model_validate(item) for item in raw]

    def get_model(self, model_id: str) -> ModelInfo:
        for model in self.list_models():
            if model.id == model_id:
                return model
        raise KeyError(f"Unknown model: {model_id}")
