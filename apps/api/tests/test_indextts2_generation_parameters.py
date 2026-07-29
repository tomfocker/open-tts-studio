from pathlib import Path

from tools.indextts2_worker import synthesize
from tts_api.config import get_settings
from tts_api.model_capabilities import validate_speech_request_capabilities
from tts_api.registry import ModelRegistry
from tts_api.schemas import SpeechRequest


class FakeIndexTts:
    def __init__(self):
        self.kwargs = None

    def infer(self, **kwargs):
        self.kwargs = kwargs


def test_indextts2_worker_forwards_upstream_sampling_parameters(tmp_path: Path):
    prompt_audio = tmp_path / "prompt.wav"
    prompt_audio.write_bytes(b"RIFF")
    output_path = tmp_path / "output.wav"
    tts = FakeIndexTts()

    result = synthesize(
        tts,
        {
            "output": str(output_path),
            "prompt_audio": str(prompt_audio),
            "text": "参数透传测试",
            "temperature": 0.7,
            "top_p": 0.75,
            "top_k": 0,
            "num_beams": 2,
            "repetition_penalty": 8.5,
            "max_mel_tokens": 1200,
        },
        120,
    )

    assert result == output_path.resolve()
    assert tts.kwargs["temperature"] == 0.7
    assert tts.kwargs["top_p"] == 0.75
    assert tts.kwargs["top_k"] is None
    assert tts.kwargs["num_beams"] == 2
    assert tts.kwargs["repetition_penalty"] == 8.5
    assert tts.kwargs["max_mel_tokens"] == 1200


def test_indextts2_registry_accepts_stable_sampling_surface():
    settings = get_settings()
    model = ModelRegistry(settings.model_registry_path).get_model("indextts2")
    request = SpeechRequest(
        model="indextts2",
        input="参数能力测试",
        temperature=0.8,
        top_p=0.8,
        top_k=30,
        num_beams=3,
        repetition_penalty=10,
        max_mel_tokens=1500,
    )

    validate_speech_request_capabilities(model, request)
